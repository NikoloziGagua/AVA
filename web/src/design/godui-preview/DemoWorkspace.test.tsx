import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoWorkspace from "./DemoWorkspace.js";
import { GodUiPreview } from "./GodUiPreview.js";
import { DEMO_KEY, DESTINATIONS, freshDemo, useDemoState, type WorkspaceRoute } from "./demo-model.js";

vi.mock("./LivingFace.js",()=>({LivingFace:()=> <div/>}));
vi.mock("./vendor/warp-starfield/warp-starfield.js",()=>({WarpStarfield:()=>null}));
vi.mock("@paper-design/shaders",()=>({ShaderMount:class {dispose(){} setSpeed(){}},liquidMetalFragmentShader:""}));
function Harness({route}:{route:WorkspaceRoute}){const demo=useDemoState();return <DemoWorkspace route={route} demo={demo} navigate={navigate}/>;}
const navigate=vi.fn();
beforeEach(()=>{localStorage.clear();history.replaceState(null,"","/");navigate.mockClear();vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}unobserve(){}});Element.prototype.scrollTo=vi.fn();HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const stored=()=>JSON.parse(localStorage.getItem(DEMO_KEY)!);
describe("complete metal demo",()=>{
  for(const [route,title] of DESTINATIONS.filter(d=>!["home","voice","components"].includes(d[0])))it(`renders ${title} without a live call`,()=>{
    const fetch=vi.spyOn(globalThis,"fetch");render(<Harness route={route as WorkspaceRoute}/>);
    expect(screen.getByRole("heading",{level:1,name:title})).toBeTruthy();expect(screen.getByText("LOCAL DEMO · SAMPLE DATA")).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
  });
  it("navigates via keyboard-friendly menu, restores route and responds to Back",async()=>{
    render(<GodUiPreview/>);fireEvent.click(screen.getByRole("button",{name:"All AVA workspaces"}));
    const dialog=screen.getByRole("dialog",{name:"Your AVA"});expect(within(dialog).getAllByRole("button")).toHaveLength(20);
    fireEvent.change(screen.getByRole("textbox",{name:"Find a workspace"}),{target:{value:"calendar"}});fireEvent.click(within(dialog).getByRole("button",{name:/Calendar/}));
    await screen.findByRole("heading",{level:1,name:"Calendar"});expect(location.hash).toBe("#demo=calendar");expect(screen.queryByRole("dialog")).toBeNull();cleanup();render(<GodUiPreview/>);await screen.findByRole("heading",{level:1,name:"Calendar"});
    history.replaceState(null,"","#demo=notes");fireEvent(window,new PopStateEvent("popstate"));await screen.findByRole("heading",{level:1,name:"Notes"});
  });
  it("creates a nested folder and file, persists, edits, pins, deletes and undoes",()=>{
    render(<Harness route="notes"/>);fireEvent.click(screen.getByRole("button",{name:"New folder"}));fireEvent.change(screen.getByLabelText("Folder name"),{target:{value:"Research"}});fireEvent.change(screen.getByLabelText("Inside"),{target:{value:"uni"}});fireEvent.click(screen.getByRole("button",{name:"Create folder"}));expect(stored().folders.at(-1).parent).toBe("uni");
    fireEvent.click(screen.getByRole("button",{name:"New file"}));fireEvent.change(screen.getByLabelText("Title"),{target:{value:"My exact note"}});fireEvent.change(screen.getByLabelText("Content · Markdown supported"),{target:{value:"# Thought\n\n**Keep this**\n\n## Next\nQuestion?"}});fireEvent.click(screen.getByRole("button",{name:"Save file"}));expect(stored().notes[0].title).toBe("My exact note");
    fireEvent.click(screen.getByRole("button",{name:"Next page"}));expect(screen.getByText("Question?")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Pin file"}));expect(stored().notes[0].pinned).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Edit"}));fireEvent.change(screen.getByLabelText("Title"),{target:{value:"Refined thought"}});fireEvent.click(screen.getByRole("button",{name:"Save file"}));fireEvent.click(screen.getByRole("button",{name:"Delete file"}));expect(stored().notes.some((n:any)=>n.title==="Refined thought")).toBe(false);fireEvent.click(screen.getByRole("button",{name:"Undo"}));cleanup();render(<Harness route="notes"/>);expect(screen.getByText("Refined thought")).toBeTruthy();
  });
  it("creates and updates a calendar event without scheduling a live action",()=>{
    const fetch=vi.spyOn(globalThis,"fetch");render(<Harness route="calendar"/>);fireEvent.click(screen.getByRole("button",{name:"New event"}));fireEvent.change(screen.getByLabelText("Event title"),{target:{value:"A study block"}});fireEvent.change(screen.getByLabelText("Attendance"),{target:{value:"Independent study"}});fireEvent.click(screen.getByRole("button",{name:"Save event"}));expect(stored().events.at(-1).attendance).toBe("Independent study");expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps exact submitted words across reload and saves the reply to Notes",()=>{
    const fetch=vi.spyOn(globalThis,"fetch");render(<Harness route="chat"/>);const box=screen.getByRole("textbox",{name:"Message AVA in demo"});fireEvent.change(box,{target:{value:"_name / https://example.com?a=1&b=2\n日本語"}});fireEvent.keyDown(box,{key:"Enter",isComposing:true});expect(stored().chats[0].messages).toHaveLength(2);fireEvent.click(screen.getByRole("button",{name:"Send demo message"}));expect(stored().chats[0].messages).toHaveLength(4);expect(stored().chats[0].messages[2].text).toBe("_name / https://example.com?a=1&b=2\n日本語");fireEvent.click(screen.getAllByRole("button",{name:"Save to Notes"}).at(-1)!);expect(stored().notes[0].title).toBe("A thought from Talk");cleanup();render(<Harness route="chat"/>);expect(screen.getByText(/https:\/\/example.com/)).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
  });
  it("hands a room conclusion to the exact new demo conversation",()=>{render(<Harness route="strategy"/>);fireEvent.click(screen.getByRole("button",{name:"Conclusion"}));fireEvent.click(screen.getByRole("button",{name:"Approve demo conclusion"}));fireEvent.click(screen.getByRole("button",{name:/Take back to Talk/}));expect(stored().currentChat).toBe(stored().chats[0].id);expect(navigate).toHaveBeenCalledWith("chat");});
  it("changes preferences and resets only demo storage",()=>{localStorage.setItem("unrelated","keep");render(<Harness route="settings"/>);fireEvent.change(screen.getByLabelText("Speed"),{target:{value:"Thorough"}});expect(stored().preferences.speed).toBe("Thorough");fireEvent.click(screen.getByRole("button",{name:"Reset demo"}));fireEvent.click(screen.getByRole("button",{name:"Reset demo data"}));expect(stored().preferences.speed).toBe("Fast");expect(localStorage.getItem("unrelated")).toBe("keep");});
  it.each(["{bad",JSON.stringify({version:9}),JSON.stringify({...freshDemo(),notes:[{id:"bad",body:12}]})])("recovers honestly from incompatible/malformed local storage",raw=>{localStorage.setItem(DEMO_KEY,raw);render(<Harness route="notes"/>);expect(screen.getByRole("heading",{name:"Shorter loops, better decisions"})).toBeTruthy();});
  it("displays storage failure without preventing use",async()=>{vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("denied");});history.replaceState(null,"","#demo=today");render(<GodUiPreview/>);await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("Browser storage unavailable"));});
  it("supports visual keyboard scenes and explicit context handoff",()=>{render(<Harness route="visuals"/>);const canvas=screen.getByLabelText("Visual walkthrough. Arrow keys change scene.");fireEvent.keyDown(canvas,{key:"ArrowRight"});expect(screen.getByText("SCENE 2 OF 4")).toBeTruthy();expect(navigate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Ask AVA about this"}));expect(stored().chats[0].messages[0].text).toContain("Explore the possibilities");expect(navigate).toHaveBeenCalledWith("chat");});
});
