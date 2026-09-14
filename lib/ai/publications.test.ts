import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({response:vi.fn(),image:vi.fn(),edit:vi.fn()}));
vi.mock("openai",()=>{
  class APIError extends Error {}
  class Client { static APIError=APIError; responses={create:mocks.response};images={generate:mocks.image,edit:mocks.edit}; }
  return {default:Client,toFile:vi.fn(async value=>value)};
});
import { generatePublicationIdeas, generatePublicationText, generatePublicationImage } from "./publications";
import { DEFAULT_AUTHORING } from "@/lib/publications/authoring";
const input={...structuredClone(DEFAULT_AUTHORING),channelIds:["a1000000-0000-4000-8000-000000000001"]};
const context={input,channels:[{id:input.channelIds[0],name:"Shop",platform:"instagram"}],knowledge:[{name:"Контакт",content:"sales@example.com"}]};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("OPENAI_API_KEY","test-key");});
describe("OpenAI publication boundary",()=>{
  it("masks private data, disables response storage and restores text after parsing",async()=>{
    mocks.response.mockResolvedValue({status:"completed",output_text:JSON.stringify({title:"Test",variants:[{channelIndex:0,body:"Пишите {{EMAIL_1}}"}],imagePrompt:"Shop"}),usage:{input_tokens:10,output_tokens:20}});
    const output=await generatePublicationText(context);
    const request=mocks.response.mock.calls[0][0];expect(request.store).toBe(false);expect(request.text.format.strict).toBe(true);
    expect(JSON.stringify(request)).not.toContain("sales@example.com");expect(JSON.stringify(request)).not.toContain(input.channelIds[0]);
    expect(output.result.variants[0].body).toBe("Пишите sales@example.com");expect(output.result.variants[0].channelId).toBe(input.channelIds[0]);
  });
  it("rejects truncated responses and missing channel versions",async()=>{
    mocks.response.mockResolvedValue({status:"incomplete",output_text:"{}"});await expect(generatePublicationText(context)).rejects.toThrow("не завершила");
    mocks.response.mockResolvedValue({status:"completed",output_text:JSON.stringify({title:"Post",variants:[],imagePrompt:""})});await expect(generatePublicationText(context)).rejects.toThrow("неполные");
  });
  it("enforces batches of three complete ideas",async()=>{
    mocks.response.mockResolvedValue({status:"completed",output_text:JSON.stringify({ideas:[{...input.brief,topic:"one"}]})});
    await expect(generatePublicationIdeas(context)).rejects.toThrow("неполные идеи");
  });
  it("uses separate image generation with explicit aspect ratio and reference editing",async()=>{
    mocks.image.mockResolvedValue({data:[{b64_json:Buffer.from("png").toString("base64")}],usage:{output_tokens:4}});
    mocks.edit.mockResolvedValue({data:[{b64_json:Buffer.from("png").toString("base64")}]});
    await generatePublicationImage(input,"Shop");expect(mocks.image.mock.calls[0][0]).toMatchObject({size:"1024x1280",quality:"medium",n:1});
    await generatePublicationImage(input,"Shop",{bytes:new Uint8Array([1]),mime:"image/png"});expect(mocks.edit).toHaveBeenCalledOnce();
  });
});
