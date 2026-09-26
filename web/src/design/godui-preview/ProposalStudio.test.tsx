import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProposalStudio, { STUDIES } from "./ProposalStudio.js";
import { GodUiPreview } from "./GodUiPreview.js";

vi.mock("./LivingFace.js",()=>({LivingFace:()=> <div role="img" aria-label="Proposed AVA face"/>}));
vi.mock("@paper-design/shaders",()=>({ShaderMount:class {dispose(){} setSpeed(){}},liquidMetalFragmentShader:""}));
beforeEach(()=>{
  history.replaceState(null,"","/");localStorage.clear();
  vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});
  vi.stubGlobal("IntersectionObserver",class {observe(){} unobserve(){} disconnect(){}});
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(null);
  Element.prototype.scrollTo=vi.fn();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const choose=(name:string)=>fireEvent.click(within(screen.getByRole("navigation",{name:"Proposed screens"})).getByRole("button",{name:new RegExp(name+"$")}));

describe("joint composition proposal",()=>{
  for(const study of STUDIES)it(`shows ${study.name} as a labelled local study`,()=>{
    const fetch=vi.spyOn(globalThis,"fetch");
    render(<ProposalStudio navigate={vi.fn()}/>);choose(study.name);
    expect(screen.getByRole("heading",{level:2,name:study.name})).toBeTruthy();
    expect(screen.getByText(study.why)).toBeTruthy();
    expect(screen.getByText(/Sample content only/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("opens the island detail, compares materials and retains an Ideas list option",()=>{
    render(<ProposalStudio navigate={vi.fn()}/>);
    const island=screen.getByRole("button",{name:"Reveal today's one thing"});fireEvent.click(island);
    expect(island.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Live AVA would use/)).toBeTruthy();
    choose("Metal comparison");
    fireEvent.click(screen.getByRole("button",{name:"Try real liquid metal"}));
    expect(screen.getByRole("status").textContent).toBe("Real shader pressed.");
    fireEvent.click(screen.getByRole("button",{name:"Paper study"}));
    expect(screen.getByRole("button",{name:"Paper study"}).getAttribute("aria-pressed")).toBe("true");
    choose("Ideas");fireEvent.click(screen.getByRole("button",{name:"List"}));
    expect(screen.getByRole("heading",{name:"An assistant that feels present"})).toBeTruthy();
  });
  it("navigates explicitly to the full demo and never equates samples with saved work",()=>{
    const navigate=vi.fn();render(<ProposalStudio navigate={navigate}/>);choose("Notes");
    fireEvent.click(screen.getByRole("button",{name:"Open full notes layout"}));expect(navigate).toHaveBeenCalledTimes(1);expect(navigate).toHaveBeenCalledWith("notes");
    choose("Talk");fireEvent.click(screen.getByRole("button",{name:"What AVA did · sample"}));
    expect(screen.getByText(/A live version would use actual tool steps/)).toBeTruthy();
  });
  it("restores the preview-only proposal route after reload",async()=>{
    history.replaceState(null,"","/?godui-preview#demo=proposal");render(<GodUiPreview/>);
    expect(await screen.findByRole("heading",{name:"AVA, with a little more life."})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Expand Ask AVA"})).toBeNull();
  });
  it("mounts only the chosen study and changes structural lines locally",()=>{
    const fetch=vi.spyOn(globalThis,"fetch");const {container}=render(<ProposalStudio navigate={vi.fn()}/>);
    const board=container.querySelector(".ps-artboard")!;
    expect(board.getAttribute("data-lines")).toBe("false");
    fireEvent.click(screen.getByRole("checkbox",{name:"Quiet structural lines"}));
    expect(board.getAttribute("data-lines")).toBe("true");
    choose("Notes");expect(container.querySelector(".ps-presence")).toBeNull();
    expect(container.querySelectorAll(".ps-artboard")).toHaveLength(1);
    expect(board.getAttribute("data-study")).toBe("notes");expect(fetch).not.toHaveBeenCalled();
  });
});
