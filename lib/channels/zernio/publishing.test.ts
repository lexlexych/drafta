import {afterEach,describe,expect,it,vi} from "vitest";
import {publishZernioPost,getZernioPublishedPost,normalizePublishedPost} from "./publishing";
const config={apiBaseUrl:"https://provider.test/v1",apiKey:"server-key"};
const input={requestId:"a1000000-0000-4000-8000-000000000001",externalAccountId:"li",platform:"linkedin" as const,title:"Title",body:"Text",media:[{type:"document" as const,url:"https://storage.test/slides.pdf"}]};
afterEach(()=>vi.unstubAllGlobals());
describe("publication transport",()=>{
  it("sends the same logical request ID and a document title for LinkedIn",async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({post:{_id:"remote",platforms:[{accountId:"li",status:"published",platformPostId:"native",platformPostUrl:"https://linkedin.com/post"}]}}));vi.stubGlobal("fetch",fetch);
    expect(await publishZernioPost(config,input)).toMatchObject({remoteId:"remote",externalId:"native",status:"published"});
    const call=fetch.mock.calls[0];expect(call[1].headers["x-request-id"]).toBe(input.requestId);expect(JSON.parse(call[1].body)).toMatchObject({publishNow:true,platforms:[{platform:"linkedin",accountId:"li",platformSpecificData:{documentTitle:"Title"}}]});
  });
  it("reads the original post returned by content deduplication instead of creating again",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({existingPostId:"original"},{status:409})).mockResolvedValueOnce(Response.json({post:{_id:"original",platforms:[{accountId:{_id:"li"},status:"published"}]}}));vi.stubGlobal("fetch",fetch);
    expect((await publishZernioPost(config,input)).status).toBe("published");expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][1].method).toBe("GET");
  });
  it("normalizes same-request retries and never attributes another target's success",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({existingPost:{_id:"original",platforms:[{accountId:"li",status:"published"}]}})));
    expect((await publishZernioPost(config,input)).remoteId).toBe("original");
    expect(normalizePublishedPost({_id:"remote",platforms:[{accountId:"other",status:"published"}]},"li").status).toBe("pending");
  });
  it("marks network failure uncertain and keeps permission errors safe for the UI",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("secret request payload")));
    await expect(publishZernioPost(config,input)).rejects.toMatchObject({uncertain:true,retryable:true});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"private details"},{status:403})));
    await expect(getZernioPublishedPost(config,{remoteId:"remote",externalAccountId:"li"})).rejects.toMatchObject({uncertain:false,retryable:false});
  });
});
