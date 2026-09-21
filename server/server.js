import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CopyObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand,
  HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import multer from "multer";
import { createClient } from "redis";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const clientDist = path.join(root, "client-dist");
const widgetPath = path.join(root, "public", "vfs-widget.js");
const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
const cfg = {
  port: Number(process.env.PORT || 8080),
  bucket: process.env.S3_BUCKET || "public-assets",
  publicBucket: process.env.S3_PUBLIC_BUCKET || "published-assets",
  issuer: process.env.JWT_ISSUER || "vfs-auth",
  audience: process.env.JWT_AUDIENCE || "vfs-clients",
  origins: (process.env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 104857600),
};
const publicKey = fs.readFileSync(process.env.PUBLIC_KEY_PATH || "/run/secrets/public.pem", "utf8");
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: required("S3_ENDPOINT"),
  forcePathStyle: true,
  credentials: { accessKeyId: required("S3_ACCESS_KEY"), secretAccessKey: required("S3_SECRET_KEY") },
});
const redis = createClient({ url: required("REDIS_URL") });
redis.on("error", (error) => console.error("[fileserver] redis", error.message));
await redis.connect();

function cleanPath(raw, { directory = false } = {}) {
  const value = String(raw || "").normalize("NFC").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!value && directory) return "";
  if (!value || value.length > 1024 || value.includes("\0") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("invalid_path"), { status: 400 });
  }
  return value;
}
const parentPath = (value) => {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
};
const cacheKey = (user, value) => `vfs:list:${user}:${value}`;
async function invalidate(user, value) {
  try { await redis.del(cacheKey(user, value)); } catch { /* cache is best effort */ }
}
async function invalidateTree(user, value) {
  await invalidate(user, parentPath(value));
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, { MATCH: `vfs:list:${user}:${value}*`, COUNT: 200 });
    cursor = String(result.cursor);
    if (result.keys.length) await redis.unlink(result.keys);
  } while (cursor !== "0");
}
async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}
const copySource = (key, bucket = cfg.bucket) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
const publicOwnerKey = (value) => `${value}/`;

async function listAllObjects(bucket, prefix) {
  let token;
  const objects = [];
  do {
    const output = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    objects.push(...(output.Contents || []));
    token = output.IsTruncated ? output.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function deleteAllObjects(bucket, prefix) {
  const objects = await listAllObjects(bucket, prefix);
  for (let index = 0; index < objects.length; index += 1000) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: objects.slice(index, index + 1000).map(({ Key }) => ({ Key })), Quiet: true },
    }));
  }
  return objects.length;
}

async function getPublicOwner(publicPath) {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: cfg.publicBucket, Key: publicOwnerKey(publicPath) }));
    return result.Metadata?.owner || null;
  } catch (error) {
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
const authenticate = async (req, res, next) => {
  try {
    const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "missing_token" });
    const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"], issuer: cfg.issuer, audience: cfg.audience });
    if (await redis.exists(`auth:revoked:sid:${decoded.sid}`) || await redis.exists(`auth:revoked:jti:${decoded.jti}`)) {
      return res.status(401).json({ error: "session_revoked" });
    }
    req.auth = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
};

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }), compression(), express.json({ limit: "64kb" }));
app.use(cors({ origin(origin, callback) { callback(null, !origin || cfg.origins.includes(origin)); }, credentials: true }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 240 }));

app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "fileserver-vfs" }));
app.get("/widget.js", (_req, res) => res.type("application/javascript").sendFile(widgetPath));

app.post("/api/publish", authenticate, async (req, res, next) => {
  try {
    const sourcePath = cleanPath(req.body.sourcePath);
    const publicPath = cleanPath(req.body.publicPath);
    const currentOwner = await getPublicOwner(publicPath);
    if (currentOwner && currentOwner !== req.auth.sub) return res.status(409).json({ error: "public_path_owned_by_another_user" });

    const sourcePrefix = `${req.auth.sub}/${sourcePath}/`;
    const sourceObjects = await listAllObjects(cfg.bucket, sourcePrefix);
    if (!sourceObjects.length) return res.status(404).json({ error: "source_not_found_or_empty" });

    const stagingPrefix = `_staging/${req.auth.sub}/${Date.now()}-${Math.random().toString(36).slice(2)}/`;
    const staged = [];
    try {
      for (const entry of sourceObjects) {
        const relativePath = entry.Key.slice(sourcePrefix.length);
        if (!relativePath) continue;
        const targetKey = `${stagingPrefix}${relativePath}`;
        await s3.send(new CopyObjectCommand({
          Bucket: cfg.publicBucket,
          Key: targetKey,
          CopySource: copySource(entry.Key),
          MetadataDirective: "COPY",
        }));
        staged.push({ source: targetKey, relativePath });
      }
      if (!staged.length) return res.status(404).json({ error: "source_not_found_or_empty" });

      await deleteAllObjects(cfg.publicBucket, `${publicPath}/`);
      for (const entry of staged) {
        await s3.send(new CopyObjectCommand({
          Bucket: cfg.publicBucket,
          Key: `${publicPath}/${entry.relativePath}`,
          CopySource: copySource(entry.source, cfg.publicBucket),
          MetadataDirective: "COPY",
        }));
      }
      await s3.send(new PutObjectCommand({
        Bucket: cfg.publicBucket,
        Key: publicOwnerKey(publicPath),
        Body: "",
        ContentType: "application/x-directory",
        Metadata: { owner: String(req.auth.sub) },
      }));
    } finally {
      await deleteAllObjects(cfg.publicBucket, stagingPrefix).catch(() => {});
    }

    return res.json({ publicPath, url: `/vfs/public/${publicPath}/`, files: staged.length });
  } catch (error) { return next(error); }
});

app.delete("/api/public", authenticate, async (req, res, next) => {
  try {
    const publicPath = cleanPath(req.body.publicPath);
    const owner = await getPublicOwner(publicPath);
    if (!owner) return res.status(404).json({ error: "publication_not_found" });
    if (owner !== req.auth.sub) return res.status(403).json({ error: "publication_forbidden" });
    const deleted = await deleteAllObjects(cfg.publicBucket, `${publicPath}/`);
    return res.json({ publicPath, deleted });
  } catch (error) { return next(error); }
});

async function listPublicDirectory(rawPath, res, next) {
  try {
    const directory = cleanPath(rawPath, { directory: true });
    const prefix = directory ? `${directory}/` : "";
    let token;
    const contents = [];
    const commonPrefixes = [];
    do {
      const output = await s3.send(new ListObjectsV2Command({
        Bucket: cfg.publicBucket, Prefix: prefix, Delimiter: "/", ContinuationToken: token,
      }));
      contents.push(...(output.Contents || []));
      commonPrefixes.push(...(output.CommonPrefixes || []));
      token = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (token);
    const visible = (value) => value && !value.split("/").some((segment) => segment.startsWith("_"));
    const directories = commonPrefixes.map((entry) => {
      const itemPath = entry.Prefix.replace(/\/$/, "");
      return { name: itemPath.split("/").pop(), path: itemPath, type: "directory" };
    }).filter((entry) => visible(entry.path));
    const files = contents.filter((entry) => entry.Key !== prefix && !entry.Key.endsWith("/") && visible(entry.Key)).map((entry) => ({
      name: entry.Key.split("/").pop(), path: entry.Key, type: "file", size: entry.Size,
      lastModified: entry.LastModified?.toISOString(), publicUrl: `/vfs/public/${entry.Key.split("/").map(encodeURIComponent).join("/")}`,
    }));
    res.set("Cache-Control", "public, max-age=30");
    return res.json({ path: directory, items: [...directories, ...files] });
  } catch (error) { return next(error); }
}

app.get("/public", (_req, res) => res.redirect(308, "/public/"));
app.get("/public/", (req, res, next) => listPublicDirectory("", res, next));
app.get("/public/*", async (req, res, next) => {
  try {
    if (req.path.endsWith("/")) return listPublicDirectory(req.params[0], res, next);
    const objectPath = cleanPath(req.params[0]);
    const range = req.get("range");
    const output = await s3.send(new GetObjectCommand({ Bucket: cfg.publicBucket, Key: objectPath, Range: range || undefined }));
    res.status(output.ContentRange ? 206 : 200);
    if (output.ContentType) res.type(output.ContentType);
    if (output.ContentLength != null) res.set("Content-Length", String(output.ContentLength));
    if (output.ContentRange) res.set("Content-Range", output.ContentRange);
    if (output.ETag) res.set("ETag", output.ETag);
    res.set("Accept-Ranges", "bytes");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", /\.(?:json|html)$/i.test(objectPath) ? "public, max-age=60" : "public, max-age=31536000, immutable");
    output.Body.pipe(res);
  } catch (error) { return next(error); }
});

app.get("/api/list", authenticate, async (req, res, next) => {
  try {
    const directory = cleanPath(req.query.path, { directory: true });
    const key = cacheKey(req.auth.sub, directory);
    try {
      const hit = await redis.get(key);
      if (hit) return res.json({ ...JSON.parse(hit), cached: true });
    } catch { /* cache miss */ }
    const prefix = `${req.auth.sub}/${directory ? `${directory}/` : ""}`;
    let token;
    const contents = [];
    const prefixes = [];
    do {
      const output = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, Delimiter: "/", ContinuationToken: token }));
      contents.push(...(output.Contents || []));
      prefixes.push(...(output.CommonPrefixes || []));
      token = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (token);
    const directories = prefixes.map((entry) => {
      const itemPath = entry.Prefix.slice(req.auth.sub.length + 1).replace(/\/$/, "");
      return { name: itemPath.split("/").pop(), path: itemPath, type: "directory" };
    });
    const files = contents.filter((entry) => entry.Key !== prefix && !entry.Key.endsWith("/")).map((entry) => {
      const itemPath = entry.Key.slice(req.auth.sub.length + 1);
      return {
        name: itemPath.split("/").pop(), path: itemPath, type: "file", size: entry.Size,
        lastModified: entry.LastModified?.toISOString(),
        publicUrl: `/vfs/files/${encodeURIComponent(req.auth.sub)}/${itemPath.split("/").map(encodeURIComponent).join("/")}`,
        downloadUrl: `/vfs/api/download?path=${encodeURIComponent(itemPath)}`,
      };
    });
    const result = { path: directory, items: [...directories, ...files] };
    try { await redis.set(key, JSON.stringify(result), { EX: 3600 }); } catch { /* cache is best effort */ }
    return res.json({ ...result, cached: false });
  } catch (error) { return next(error); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1 } }).single("file");
app.post("/api/upload", authenticate, upload, async (req, res, next) => {
  try {
    if (!req.file) throw Object.assign(new Error("missing_file"), { status: 400 });
    const directory = cleanPath(req.body.path || "", { directory: true });
    const name = cleanPath(req.body.name || req.file.originalname);
    const objectPath = directory ? `${directory}/${name}` : name;
    const forceDownload = String(req.body.download) === "true";
    const safeName = name.replace(/["\r\n]/g, "_");
    await s3.send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: `${req.auth.sub}/${objectPath}`, Body: req.file.buffer,
      ContentType: req.file.mimetype || "application/octet-stream",
      ContentDisposition: `${forceDownload ? "attachment" : "inline"}; filename="${safeName}"`,
    }));
    await invalidate(req.auth.sub, directory);
    return res.status(201).json({ path: objectPath, publicUrl: `/vfs/files/${encodeURIComponent(req.auth.sub)}/${objectPath.split("/").map(encodeURIComponent).join("/")}` });
  } catch (error) { return next(error); }
});

app.post("/api/mkdir", authenticate, async (req, res, next) => {
  try {
    const directory = cleanPath(req.body.path);
    await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: `${req.auth.sub}/${directory}/`, Body: "", ContentType: "application/x-directory" }));
    await invalidate(req.auth.sub, parentPath(directory));
    return res.status(201).json({ path: directory, type: "directory" });
  } catch (error) { return next(error); }
});

app.delete("/api/file", authenticate, async (req, res, next) => {
  try {
    const filePath = cleanPath(req.body.path);
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: `${req.auth.sub}/${filePath}` }));
    await invalidate(req.auth.sub, parentPath(filePath));
    return res.json({ path: filePath, deleted: true });
  } catch (error) { return next(error); }
});

app.delete("/api/rmdir", authenticate, async (req, res, next) => {
  try {
    const directory = cleanPath(req.body.path);
    const prefix = `${req.auth.sub}/${directory}/`;
    const recursive = req.body.recursive === true;
    let token;
    const objects = [];
    do {
      const output = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      objects.push(...(output.Contents || []).map((entry) => ({ Key: entry.Key })));
      token = output.IsTruncated ? output.NextContinuationToken : undefined;
      if (!recursive && objects.some((entry) => entry.Key !== prefix)) return res.status(409).json({ error: "directory_not_empty" });
    } while (token);
    for (let index = 0; index < objects.length; index += 1000) {
      await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: objects.slice(index, index + 1000), Quiet: true } }));
    }
    await invalidateTree(req.auth.sub, directory);
    return res.json({ path: directory, deleted: objects.length });
  } catch (error) { return next(error); }
});

app.post("/api/rename", authenticate, async (req, res, next) => {
  try {
    const source = cleanPath(req.body.sourcePath);
    const target = cleanPath(req.body.targetPath);
    const type = req.body.type === "directory" ? "directory" : "file";
    if (source === target) return res.json({ sourcePath: source, path: target, type, renamed: false });
    if (type === "directory" && target.startsWith(`${source}/`)) throw Object.assign(new Error("invalid_target"), { status: 400 });
    const userPrefix = `${req.auth.sub}/`;
    const sourceKey = `${userPrefix}${source}`;
    const targetKey = `${userPrefix}${target}`;
    if (type === "file") {
      if (!await objectExists(sourceKey)) throw Object.assign(new Error("not_found"), { status: 404 });
      if (await objectExists(targetKey)) throw Object.assign(new Error("target_exists"), { status: 409 });
      await s3.send(new CopyObjectCommand({ Bucket: cfg.bucket, Key: targetKey, CopySource: copySource(sourceKey) }));
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: sourceKey }));
      await invalidate(req.auth.sub, parentPath(source));
      await invalidate(req.auth.sub, parentPath(target));
      return res.json({ sourcePath: source, path: target, type, renamed: true });
    }
    const sourcePrefix = `${sourceKey}/`;
    const targetPrefix = `${targetKey}/`;
    if (await objectExists(targetKey) || (await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: targetPrefix, MaxKeys: 1 }))).KeyCount > 0) {
      throw Object.assign(new Error("target_exists"), { status: 409 });
    }
    let token;
    const sourceObjects = [];
    do {
      const output = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: sourcePrefix, ContinuationToken: token }));
      sourceObjects.push(...(output.Contents || []).map((entry) => entry.Key));
      token = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (token);
    if (!sourceObjects.length) throw Object.assign(new Error("not_found"), { status: 404 });
    const copied = [];
    try {
      for (const key of sourceObjects) {
        const destination = `${targetPrefix}${key.slice(sourcePrefix.length)}`;
        await s3.send(new CopyObjectCommand({ Bucket: cfg.bucket, Key: destination, CopySource: copySource(key) }));
        copied.push({ Key: destination });
      }
    } catch (error) {
      for (let index = 0; index < copied.length; index += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: copied.slice(index, index + 1000), Quiet: true } }));
      }
      throw error;
    }
    for (let index = 0; index < sourceObjects.length; index += 1000) {
      await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: sourceObjects.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true } }));
    }
    await invalidateTree(req.auth.sub, source);
    await invalidateTree(req.auth.sub, target);
    return res.json({ sourcePath: source, path: target, type, renamed: true, objects: sourceObjects.length });
  } catch (error) { return next(error); }
});

app.get("/api/download", authenticate, async (req, res, next) => {
  try {
    const filePath = cleanPath(req.query.path);
    const range = req.get("range");
    const output = await s3.send(new GetObjectCommand({
      Bucket: cfg.bucket, Key: `${req.auth.sub}/${filePath}`, Range: range || undefined,
      ResponseContentDisposition: req.query.download === "true" ? `attachment; filename="${filePath.split("/").pop().replace(/["\r\n]/g, "_")}"` : undefined,
    }));
    res.status(output.ContentRange ? 206 : 200);
    if (output.ContentType) res.type(output.ContentType);
    if (output.ContentLength != null) res.set("Content-Length", String(output.ContentLength));
    if (output.ContentRange) res.set("Content-Range", output.ContentRange);
    res.set("Accept-Ranges", "bytes");
    if (output.ContentDisposition) res.set("Content-Disposition", output.ContentDisposition);
    output.Body.pipe(res);
  } catch (error) { next(error); }
});

app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
app.use((error, _req, res, _next) => {
  console.error("[fileserver]", error);
  const status = Number(error.status) || (error.name === "NoSuchKey" ? 404 : error.name === "MulterError" ? 413 : 500);
  res.status(status).json({ error: error.message || "internal_error" });
});

const server = app.listen(cfg.port, "0.0.0.0", () => console.log(`fileserver listening on ${cfg.port}`));
async function shutdown(signal) {
  console.log(`[fileserver] ${signal}`);
  server.close(async () => {
    if (redis.isOpen) await redis.quit();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
