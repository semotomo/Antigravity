import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log('Updating stores table with POS group settings...');

  // 本店 (id: 7) の更新
  const { error: errorMain } = await supabase
    .from('stores')
    .update({
      pos_group_id: '11098',
      pos_group_name: 'からつケンネル本店'
    })
    .eq('id', 7);

  if (errorMain) {
    console.error('Error updating main store:', errorMain);
  } else {
    console.log('Updated main store (id: 7).');
  }

  // わんわん (id: 6) の更新 (一旦 ID は null で name を設定)
  const { error: errorWanwan } = await supabase
    .from('stores')
    .update({
      pos_group_name: 'わんわん'
    })
    .eq('id', 6);

  if (errorWanwan) {
    console.error('Error updating wanwan store:', errorWanwan);
  } else {
    console.log('Updated wanwan store (id: 6).');
  }
}

main();
