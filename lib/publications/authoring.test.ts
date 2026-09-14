import { describe, expect, it } from "vitest";
import { DEFAULT_AUTHORING, generationIssue, ideaContextKey, validAuthoringInput, validResult } from "./authoring";
const channel="a1000000-0000-4000-8000-000000000001";
describe("native authoring contract",()=>{
  it("accepts partially completed forms but blocks generation without destinations and topic",()=>{
    const input=structuredClone(DEFAULT_AUTHORING);
    expect(validAuthoringInput(input)).toBe(true);expect(generationIssue(input,"ideas")).toContain("канал");
    input.channelIds=[channel];expect(generationIssue(input,"ideas")).toBeNull();expect(generationIssue(input,"post")).toContain("о чём");
    input.brief.topic="Осень";input.brief.goal="Записи";input.kind="text";expect(generationIssue(input,"post")).toBeNull();
  });
  it("rejects disabled formats, duplicate IDs and oversized fields",()=>{
    for(const kind of ["carousel","video"])expect(validAuthoringInput({...DEFAULT_AUTHORING,kind})).toBe(false);
    expect(validAuthoringInput({...DEFAULT_AUTHORING,channelIds:[channel,channel]})).toBe(false);
    expect(validAuthoringInput({...DEFAULT_AUTHORING,brief:{...DEFAULT_AUTHORING.brief,topic:"x".repeat(501)}})).toBe(false);
    expect(validAuthoringInput(null)).toBe(false);
  });
  it("requires an uploaded image but never requires an image for text-only posts",()=>{
    const input=structuredClone(DEFAULT_AUTHORING);input.channelIds=[channel];input.brief.topic="Тема";input.brief.goal="Цель";input.image.source="upload";
    expect(generationIssue(input,"post")).toContain("Загрузите");input.kind="text";expect(generationIssue(input,"post")).toBeNull();
  });
  it("marks ideas stale when sources, language or destinations change, not when brief changes",()=>{
    const key=ideaContextKey(DEFAULT_AUTHORING);
    expect(ideaContextKey({...DEFAULT_AUTHORING,brief:{...DEFAULT_AUTHORING.brief,topic:"New"}})).toBe(key);
    expect(ideaContextKey({...DEFAULT_AUTHORING,language:"Deutsch"})).not.toBe(key);
    expect(ideaContextKey({...DEFAULT_AUTHORING,kbIds:[channel]})).not.toBe(key);
  });
  it("accepts exactly one non-empty version per selected channel and no foreign versions",()=>{
    const result={title:"Title",variants:[{channelId:channel,body:"Body"}],assetIds:[]};
    expect(validResult(result,[channel])).toBe(true);
    expect(validResult({...result,variants:[...result.variants,...result.variants]},[channel])).toBe(false);
    expect(validResult(result,["b1000000-0000-4000-8000-000000000001"])).toBe(false);
  });
});
