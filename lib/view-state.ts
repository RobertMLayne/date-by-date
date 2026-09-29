import type {AppState,Profile} from "./types";

export type ProfileDetail=Profile & {readOnly?:boolean};
export type ModalContext={name:string;matchId?:string};
export function captureModal(name:string,matchId?:string):ModalContext {
 if(["date","connection-options","transparency"].includes(name))return matchId?{name,matchId}:{name:""};
 return {name};
}
export function resolveModal(state:Pick<AppState,"matches">|null,context:ModalContext){
 const match=state?.matches.find(m=>m.id===context.matchId)||null;
 return {name:context.matchId&&!match?"":context.name,match};
}
export function authorizedDetail(state:AppState,detail:ProfileDetail):ProfileDetail|null {
 if(detail.readOnly){
  if(!state.plans.capacity)return null;
  const visible=Object.values(state.transparency).flatMap(t=>[...t.connections,...t.queue]).find(p=>p.id===detail.id);
  return visible?{...visible,readOnly:true}:null;
 }
 const match=state.matches.find(m=>m.partner.id===detail.id);
 if(match)return match.partner;
 if(state.viewer&&state.viewer.activeCount>=state.viewer.capacity)return null;
 return [...state.profiles,...state.incoming,...state.outgoing].find(p=>p.id===detail.id)||null;
}
export function clearSubmittedDraft(drafts:Record<string,string>,matchId:string,submitted:string){
 return drafts[matchId]===submitted?{...drafts,[matchId]:""}:drafts;
}
