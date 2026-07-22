import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  const { data, error } = await supabase.from('stores').select('*');
  if (error) {
    console.error('Error fetching stores:', error);
    return;
  }
  console.log('--- STORES ---');
  console.log(JSON.stringify(data, null, 2));
}

main();
