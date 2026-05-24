const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';
const ALG_ID = '5377ae70-795c-48be-b5f0-282298f72e87';

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/students?id=eq.${ALG_ID}&select=id,name,program_type,progress_config`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
);
const [row] = await res.json();

console.log('── ALG2 row, program-type-related fields ──');
console.log(`  id:                          ${row.id}`);
console.log(`  name:                        ${row.name}`);
console.log(`  students.program_type:       ${JSON.stringify(row.program_type)}`);
console.log(`  progress_config.programType: ${JSON.stringify(row.progress_config?.programType)}`);
console.log(`  progress_config.subject:     ${JSON.stringify(row.progress_config?.subject)}`);

console.log('\n── Render impact ──');
const portalType = row.program_type || 'ap-prep';
console.log(`  portalType resolves to:      "${portalType}"`);
console.log(`  Will buildProgressPage() run?  ${portalType === 'ap-prep' ? 'YES ✅' : 'NO ❌ (Progress tab would be empty)'}`);
console.log(`  Will buildColleges() run?      ${portalType === 'college-counseling' ? 'YES' : 'no'}`);
