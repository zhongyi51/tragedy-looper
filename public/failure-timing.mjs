// Old saves discarded whether a non-death loss happened at Day End or Loop End.
// Normalize only recorded public facts; never recover timing from hidden roles,
// a day number, or the old prose (which used that day number as its guess).
export function normalizeFailureLog(entry){
 if(entry.type!=='failed')return entry;
 if(entry.when==='end')return {...entry,when:'legacy_end',phase:'legacy_end',text:`第 ${entry.loop} 轮回失败：失败条件成立（旧记录未区分日结束与轮回结束）。`};
 // A last-day death then loss also fits an ordinary victim plus Time Traveler.
 // Keep the death in its own public event, without asserting it caused the loss.
 if(['death','heroes'].includes(entry.when)&&['end_area','end_forced','end'].includes(entry.phase)){
  const {dead,...rest}=entry;
  return {...rest,when:'day_end',phase:'end',text:`第 ${entry.loop} 轮回失败：日结束时，失败条件成立。`};
 }
 return entry;
}
