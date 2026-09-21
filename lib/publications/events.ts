import type {JobInput,JobKind} from '@/lib/workflows/types';
function event<P extends JobInput>(kind:JobKind) {return {create:(data:P)=>({kind,data})};}
export const publicationImportRequested=event<{workspaceId:string;importId:string}>('publication-import');
export const publicationGenerationRequested=event<{workspaceId:string;jobId:string}>('publication-generation');
export const publicationSendRequested=event<{workspaceId:string;deliveryId:string}>('publication-send');
