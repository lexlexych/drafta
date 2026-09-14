import {beforeEach,describe,expect,it,vi} from "vitest";
import sharp from "sharp";
import {PDFDocument} from "pdf-lib";
vi.mock("server-only",()=>({}));vi.mock("@/lib/channels/zernio",()=>({}));
const mocks=vi.hoisted(()=>({db:vi.fn(),publish:vi.fn(),get:vi.fn(),retry:vi.fn()}));
vi.mock("@/lib/db/admin",()=>({createAdminSupabaseClient:mocks.db}));
vi.mock("@/lib/channels/registry",()=>({resolveChannelAdapter:()=>({publishPost:mocks.publish,getPublishedPost:mocks.get,retryPublishPost:mocks.retry})}));
vi.mock("./server",()=>({check:(error:unknown)=>{if(error)throw error;},PublicationError:class extends Error{}}));
import {preparePublicationMedia,runPublicationDelivery} from "./publishing";
import {PublicationTransportError} from "@/lib/channels/types";
let job:Record<string,unknown>;let member=true;let source:Buffer;let uploads:{path:string;bytes:Uint8Array}[];
const snapshot={title:"Title",body:"Body",kind:"image",assetIds:["image-1"]};
beforeEach(async()=>{
  vi.clearAllMocks();member=true;uploads=[];source=await sharp({create:{width:120,height:300,channels:3,background:"red"}}).png().toBuffer();
  job={id:"delivery",workspace_id:"workspace",draft_id:"draft",channel_id:"channel",created_by:"user",status:"pending",snapshot,remote_id:null,media:[],first_sent_at:null,created_at:new Date().toISOString()};
  mocks.publish.mockResolvedValue({remoteId:"remote",status:"published",url:"https://instagram.com/post"});
  mocks.get.mockResolvedValue({remoteId:"remote",status:"published"});
  mocks.db.mockImplementation(()=>({
    from:(table:string)=>{
      let patch:Record<string,unknown>|undefined;
      const response=()=>{
        if(patch&&table==="publication_deliveries")Object.assign(job,patch);
        return {error:null,data:table==="publication_deliveries"?{...job}:table==="workspace_members"?(member?{user_id:"user"}:null):table==="channel_connections"?{provider:"zernio",external_id:"external",platform:"instagram",status:"active"}:table==="publication_assets"?{storage_path:"original"}:null};
      };
      const query={select:()=>query,eq:()=>query,update:(value:Record<string,unknown>)=>{patch=value;return query;},insert:()=>query,single:async()=>response(),maybeSingle:async()=>response(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(response()).then(resolve)};
      return query;
    },
    storage:{from:()=>({download:async()=>({data:new Blob([new Uint8Array(source)]),error:null}),upload:async(path:string,bytes:Uint8Array)=>{uploads.push({path,bytes});return {error:null};},createSignedUrl:async(path:string)=>({data:{signedUrl:`https://storage.test/${path}`},error:null})})},
  }));
});
describe("publication delivery safety",()=>{
  it("does not send already published targets",async()=>{job.status="published";await runPublicationDelivery("workspace","delivery");expect(mocks.publish).not.toHaveBeenCalled();});
  it("reads the known remote post without publishing it again",async()=>{job.remote_id="remote";job.status="sending";await runPublicationDelivery("workspace","delivery");expect(mocks.get).toHaveBeenCalledOnce();expect(mocks.publish).not.toHaveBeenCalled();expect(job.status).toBe("published");});
  it("stops blind retries outside the provider idempotency window",async()=>{job.first_sent_at=new Date(Date.now()-300001).toISOString();await runPublicationDelivery("workspace","delivery");expect(job.status).toBe("uncertain");expect(mocks.publish).not.toHaveBeenCalled();});
  it("uses the exact saved media and request ID for a transient retry",async()=>{job.media=[{type:"image",url:"https://storage.test/saved",path:"saved"}];job.first_sent_at=new Date().toISOString();await runPublicationDelivery("workspace","delivery");expect(mocks.publish.mock.calls[0][0]).toMatchObject({requestId:"delivery",media:[{type:"image",url:"https://storage.test/saved"}]});expect(uploads).toHaveLength(0);});
  it("blocks sending after membership revocation",async()=>{member=false;await runPublicationDelivery("workspace","delivery");expect(job.status).toBe("failed");expect(mocks.publish).not.toHaveBeenCalled();});
  it("only retries a confirmed remote failure after an explicit requeue",async()=>{job.remote_id="remote";mocks.get.mockResolvedValue({remoteId:"remote",status:"failed"});mocks.retry.mockResolvedValue({remoteId:"remote",status:"published"});await runPublicationDelivery("workspace","delivery");expect(mocks.retry).toHaveBeenCalledOnce();expect(mocks.publish).not.toHaveBeenCalled();});
  it("retains the uncertain send marker when the network fails",async()=>{mocks.publish.mockRejectedValue(new PublicationTransportError("Timeout",true,true));await expect(runPublicationDelivery("workspace","delivery")).rejects.toThrow("Timeout");expect(job.status).toBe("sending");expect(job.first_sent_at).toBeTruthy();});
});
describe("publication media",()=>{
  it("builds one PDF with one page per carousel slide",async()=>{const media=await preparePublicationMedia("workspace","draft",{...snapshot,kind:"carousel",assetIds:["first","second"]},"linkedin");expect(media).toHaveLength(1);expect(media[0].type).toBe("document");const pdf=await PDFDocument.load(uploads[0].bytes);expect(pdf.getPageCount()).toBe(2);expect(pdf.getPage(0).getSize()).toEqual({width:1080,height:1350});});
  it("converts images to compatible JPEG without cropping away their edges",async()=>{await preparePublicationMedia("workspace","draft",snapshot,"instagram");const image=sharp(uploads[0].bytes);expect(await image.metadata()).toMatchObject({format:"jpeg",width:1080,height:1350});const corner=await image.extract({left:0,top:0,width:1,height:1}).raw().toBuffer();expect([...corner]).toEqual([255,255,255]);});
});
