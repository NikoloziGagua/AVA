import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarSurface, dragBlock, validCalendarEvent } from "./LivingCalendar.js";
import { freshDemo } from "./demo-model.js";
vi.mock("./GradientWave.js",()=>({GradientWave:()=> <div data-testid="shared-wave"/>}));
vi.mock("./vendor/tilt-card/tilt-card.js",()=>({TiltCard:({children,className}:any)=><div className={className}>{children}</div>}));
beforeEach(()=>{vi.stubGlobal("requestAnimationFrame",(f:FrameRequestCallback)=>{f(0);return 1;});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const setup=()=>{const onSave=vi.fn(),onDelete=vi.fn();render(<CalendarSurface events={freshDemo().events} onSave={onSave} onDelete={onDelete}/>);return {onSave,onDelete};};
describe("living sample calendar",()=>{
  it("shows a month and selected day without a live request",()=>{const fetch=vi.spyOn(globalThis,"fetch");setup();expect(screen.getByRole("heading",{name:"September 2026"})).toBeTruthy();expect(screen.getAllByTestId("shared-wave")).toHaveLength(1);expect(screen.getByRole("button",{name:"2026-09-25"}).getAttribute("aria-pressed")).toBe("true");expect(fetch).not.toHaveBeenCalled();});
  it("opens a compact day-specific draft, cancels without saving, and returns focus",async()=>{
    const {onSave}=setup();const opener=screen.getByRole("button",{name:"Add block on 2026-09-26"});opener.focus();fireEvent.click(opener);
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-26");fireEvent.change(screen.getByLabelText("Event title"),{target:{value:"Unsent thought"}});
    fireEvent.keyDown(screen.getByLabelText("Event title"),{key:"Escape"});expect(screen.queryByRole("form",{name:"Time block editor"})).toBeNull();expect(onSave).not.toHaveBeenCalled();await waitFor(()=>expect(document.activeElement).toBe(opener));
  });
  it("saves exact title/date/duration only after explicit submission",()=>{
    const {onSave}=setup();fireEvent.click(screen.getByRole("button",{name:"New event"}));fireEvent.change(screen.getByLabelText("Event title"),{target:{value:"Read λ / exact_name"}});fireEvent.change(screen.getByLabelText("Duration in minutes"),{target:{value:"45"}});
    expect(onSave).not.toHaveBeenCalled();fireEvent.submit(screen.getByRole("form",{name:"Time block editor"}));expect(onSave).toHaveBeenCalledTimes(1);expect(onSave.mock.calls[0]![0]).toMatchObject({title:"Read λ / exact_name",date:"2026-09-25",time:"14:00",duration:45});expect(screen.getByRole("status").textContent).toContain("real calendar is unchanged");
  });
  it("supports keyboard-equivalent week slots and preserves off-canvas events in Agenda",()=>{
    const onSave=vi.fn();render(<CalendarSurface events={[...freshDemo().events,{...freshDemo().events[0]!,id:"early",title:"Early sample",time:"06:00"}]} onSave={onSave} onDelete={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Week"}));fireEvent.click(screen.getByRole("button",{name:"Add block on 2026-09-25 at 10:00"}));expect((screen.getByLabelText("Time · Europe/Dublin") as HTMLInputElement).value).toBe("10:00");fireEvent.click(screen.getByRole("button",{name:"Cancel time block"}));fireEvent.click(screen.getByRole("button",{name:"Agenda"}));expect(screen.getByRole("button",{name:/2026-09-25 · 06:00 Early sample/})).toBeTruthy();
  });
  it("opens an existing event and deletes only through the local owner callback",()=>{const {onDelete}=setup();fireEvent.click(screen.getByRole("button",{name:"Agenda"}));fireEvent.click(screen.getByRole("button",{name:/2026-09-25 · 09:00 Agile Development/}));expect((screen.getByLabelText("Event title") as HTMLInputElement).value).toBe("Agile Development");fireEvent.click(screen.getByRole("button",{name:"Delete event"}));expect(onDelete).toHaveBeenCalledWith("e1");});
  it("rejects impossible dates, invalid time and duration rather than drawing invented positions",()=>{const event=freshDemo().events[0]!;expect(validCalendarEvent(event)).toBe(true);for(const bad of [{date:"2026-02-30"},{date:"bad"},{time:"24:01"},{duration:NaN},{duration:0}])expect(validCalendarEvent({...event,...bad})).toBe(false);});
  it("bounds and quantizes forward/backward drag drafts to 15 minutes",()=>{expect(dragBlock(4,6)).toEqual({time:"09:00",duration:45});expect(dragBlock(6,4)).toEqual({time:"09:00",duration:45});expect(dragBlock(-20,100)).toEqual({time:"08:00",duration:720});expect(dragBlock(0,0)).toEqual({time:"08:00",duration:15});});
});
