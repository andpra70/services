/** @typedef {{name:string,path:string,type:'file'|'directory',size?:number,lastModified?:string,publicUrl?:string,downloadUrl?:string}} VfsEntry */
/** @typedef {{path:string,items:VfsEntry[],cached:boolean}} VfsListing */
export const modelVersion = 1;
