import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodUiPreview } from "./GodUiPreview.js";
import { REFERENCES } from "./ReferenceCatalog.js";

vi.mock("./LivingFace.js", () => ({ LivingFace: ({mode}: {mode:string}) => <div data-testid="face" data-mode={mode}/> }));
vi.mock("@paper-design/shaders", () => ({ ShaderMount: class { dispose(){} setSpeed(){} }, liquidMetalFragmentShader:"" }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(){} unobserve(){} disconnect(){} });
  vi.stubGlobal("IntersectionObserver", class { observe(){} unobserve(){} disconnect(){} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(null);
  Element.prototype.scrollTo=vi.fn();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("metal preview",()=>{
  it("shows the metal Home without starting any real action",async()=>{
    const fetch=vi.spyOn(globalThis,"fetch");
    render(<GodUiPreview/>);
    expect(screen.getByRole("heading",{name:"Good to see you, Niko."})).toBeTruthy();
    expect(screen.getByText("DESIGN PREVIEW")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("YOUR DAY")).toBeNull();
    expect(screen.queryByText("Europe / Dublin")).toBeNull();
    await waitFor(()=>expect(screen.getByTestId("face").dataset.mode).toBe("idle"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves exact draft across collapse, Home and Voice, then submits locally once",async()=>{
    render(<GodUiPreview/>);
    fireEvent.click(screen.getByRole("button",{name:"Expand Ask AVA"}));
    const input=screen.getByRole("textbox",{name:"Ask AVA anything"});
    expect(document.activeElement).toBe(input);
    fireEvent.change(input,{target:{value:"_princi150 / exact? x=1"}});
    fireEvent.keyDown(input,{key:"Escape"});
    fireEvent.click(screen.getByRole("button",{name:"Voice"}));
    fireEvent.click(screen.getByRole("button",{name:"Type exact wording"}));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("_princi150 / exact? x=1");
    fireEvent.click(screen.getByRole("button",{name:"Submit preview thought"}));
    expect(within(screen.getByRole("complementary",{name:"Preview conversation"})).getByText("_princi150 / exact? x=1")).toBeTruthy();
    expect(screen.getAllByText("YOUR THOUGHT")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("never submits blank text, Shift+Enter or an IME composition",()=>{
    render(<GodUiPreview/>);
    fireEvent.click(screen.getByRole("button",{name:"Expand Ask AVA"}));
    expect((screen.getByRole("button",{name:"Submit preview thought"}) as HTMLButtonElement).disabled).toBe(true);
    const input=screen.getByRole("textbox");
    fireEvent.change(input,{target:{value:"日本語"}});
    fireEvent.keyDown(input,{key:"Enter",isComposing:true});
    fireEvent.keyDown(input,{key:"Enter",shiftKey:true});
    expect(screen.queryByText("YOUR THOUGHT")).toBeNull();
    expect(screen.getByRole("textbox")).toBe(input);
  });
  it("keeps one face while switching voice states and returns Home",async()=>{
    render(<GodUiPreview/>);
    fireEvent.click(screen.getByRole("button",{name:"Talk to AVA"}));
    await waitFor(()=>expect(screen.getByTestId("face").dataset.mode).toBe("listening"));
    fireEvent.click(screen.getByText("Preview states"));
    fireEvent.click(screen.getByRole("button",{name:"thinking"}));
    expect(screen.getByTestId("face").dataset.mode).toBe("thinking");
    expect(screen.getAllByTestId("face")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button",{name:"Leave voice"}));
    expect(screen.getByRole("heading",{name:"Good to see you, Niko."})).toBeTruthy();
  });
  it("lists every supplied reference including both beams and both shader examples",()=>{
    render(<GodUiPreview/>);
    fireEvent.click(screen.getByRole("button",{name:"Components"}));
    const catalog=screen.getByRole("navigation",{name:"Component references"});
    expect(within(catalog).getAllByRole("button")).toHaveLength(21);
    for(const name of REFERENCES)expect(within(catalog).getByText(name)).toBeTruthy();
    expect(screen.queryByTestId("face")).toBeNull();
    fireEvent.click(within(catalog).getByText("Stepper"));
    fireEvent.click(screen.getByRole("button",{name:"Next"}));
    expect(screen.getByRole("heading",{name:"Stepper"})).toBeTruthy();
  });
  it("restores the app theme on unmount and exposes a reversible warp switch",()=>{
    document.documentElement.dataset.look="paper";
    const {unmount}=render(<GodUiPreview/>);
    expect(document.documentElement.dataset.look).toBe("ink");
    fireEvent.click(screen.getByRole("button",{name:"Gentle motion"}));
    expect(screen.getByRole("button",{name:"Hyperspace"}).getAttribute("aria-pressed")).toBe("true");
    unmount();
    expect(document.documentElement.dataset.look).toBe("paper");
  });
});
