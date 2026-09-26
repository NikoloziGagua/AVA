import { TodayDemo, NotesDemo } from "./LifeWorkspaces.js";
import { CalendarDemo } from "./LivingCalendar.js";
import { TalkDemo, StrategyDemo } from "./TalkWorkspaces.js";
import { MemoryDemo, ExploreDemo, VisualsDemo } from "./KnowledgeWorkspaces.js";
import { WatchesDemo, ActivityDemo, SelfDemo, SettingsDemo, OnboardingDemo } from "./SystemWorkspaces.js";
import { DESTINATIONS, type WorkspaceProps } from "./demo-model.js";
import { GradientWave } from "./GradientWave.js";

export default function DemoWorkspace(props:WorkspaceProps){
  const {route}=props;
  const title=DESTINATIONS.find(d=>d[0]===route)!;
  const Screen=route==="today"?TodayDemo:route==="notes"||route==="ideas"?NotesDemo:route==="calendar"?CalendarDemo:route==="chat"||route==="chats"?TalkDemo:route==="memory"?MemoryDemo:route==="explore"?ExploreDemo:route==="visuals"?VisualsDemo:route==="watches"?WatchesDemo:route==="activity"?ActivityDemo:route==="self"?SelfDemo:route==="settings"?SettingsDemo:route==="strategy"?StrategyDemo:OnboardingDemo;
  return <main className={`dm-workspace dm-workspace-${route}`}>{(route==="today"||route==="ideas")&&<div className="dm-living-backdrop" aria-hidden="true"><GradientWave colors={["#a6b5ca","#242f43","#d8e0ee","#7185a4"]}/></div>}<header className="dm-page-heading"><div><span className="dm-eyebrow">{title[2]}</span><h1>{title[1]}</h1></div><span className="dm-fixture-label">LOCAL DEMO · SAMPLE DATA</span></header><Screen key={route} {...props}/><footer className="dm-workspace-foot">AVA / INTERFACE STUDY <span>No live accounts, messages or automation. Your edits stay in this browser.</span></footer></main>;
}
