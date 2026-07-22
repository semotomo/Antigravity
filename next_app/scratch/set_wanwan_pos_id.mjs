import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log('Updating wanwan store pos_group_id to 11054...');

  const { data, error } = await supabase
    .from('stores')
    .update({
      pos_group_id: '11054',
      pos_group_name: 'わんわん'
    })
    .eq('id', 6)
    .select();

  if (error) {
    console.error('Error updating wanwan store:', error);
  } else {
    console.log('Successfully updated wanwan store:', JSON.stringify(data, null, 2));
  }
}

main();
