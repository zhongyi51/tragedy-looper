// Budgets are metadata: changing one must not advance play or reset the ledger.
export function budgetValue(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<.01||value>10)throw Object.assign(Error('花费上限须在 $0.01–$10 之间'),{code:'INVALID_BUDGET',status:400});
 return value;
}
export function budgetChange(body){
 return {budget:budgetValue(body.budget),expectedBudget:budgetValue(body.expectedBudget)};
}
