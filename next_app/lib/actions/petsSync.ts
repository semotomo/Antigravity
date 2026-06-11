'use server';

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { Database } from '../types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Supabaseクライアント（サーバー環境から実行するためSERVICE_ROLE_KEYがあればそれを使う。今回はANON_KEYで代用する可能性もあり）
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CMS_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi";
const USERNAME = process.env.CMS_USERNAME || "manager";
const PASSWORD = process.env.CMS_PASSWORD || "Wn3fyuVTa9";

export async function syncPetsData() {
  try {
    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0');
    // ベーシック認証ヘッダー
    const authString = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    headers.set('Authorization', `Basic ${authString}`);

    // 1. ダッシュボードへアクセスしてクッキーとフォーム情報を取得
    const dashRes = await fetch(`${CMS_URL}?__mode=dashboard`, { headers });
    if (!dashRes.ok) throw new Error(`Dashboard access failed: ${dashRes.status}`);
    
    let cookie = dashRes.headers.get('set-cookie') || '';
    // 簡単なクッキーの抽出（複数ある場合は連結）
    if (cookie) {
      cookie = cookie.split(',').map(c => c.split(';')[0]).join('; ');
      headers.set('Cookie', cookie);
    }

    const dashText = await dashRes.text();
    const $ = cheerio.load(dashText);
    
    // ログインフォームがある場合（Basic認証だけでなくフォーム認証も必要な場合）
    const form = $('form').first();
    const action = form.attr('action') || '';
    if (action.includes('login') || dashText.includes('name="magic_token"')) {
      const formData = new URLSearchParams();
      form.find('input').each((_, el) => {
        const name = $(el).attr('name');
        const type = $(el).attr('type');
        const value = $(el).attr('value') || '';
        if (name) {
          if (name === 'username' || (type === 'text' && !value)) formData.append(name, USERNAME);
          else if (type === 'password') formData.append(name, PASSWORD);
          else formData.append(name, value);
        }
      });
      
      const loginAction = action.startsWith('http') ? action : `https://www.pets-kennel.com${action}`;
      const loginRes = await fetch(loginAction, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(headers.entries()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });
      
      const loginCookie = loginRes.headers.get('set-cookie');
      if (loginCookie) {
        cookie += '; ' + loginCookie.split(',').map(c => c.split(';')[0]).join('; ');
        headers.set('Cookie', cookie);
      }
    }

    // 2. 犬と猫のデータ取得 (blog_id=73, 82)
    const blogs = [
      { id: 73, type: 'dog' },
      { id: 82, type: 'cat' }
    ];

    let processedCount = 0;

    for (const blog of blogs) {
      // 一覧JSON取得 (本来は__mode=filtered_list等を使うが、今回は簡易的に最新エントリIDを取得するため一覧HTMLを読む手もある。
      // temp_scrape_target_entries.py にならって filtered_list は省略し、直接ID指定か、リスト画面(list_entries)をスクレイピングする)
      
      const listRes = await fetch(`${CMS_URL}?__mode=list&_type=entry&blog_id=${blog.id}`, { headers });
      const listText = await listRes.text();
      const $list = cheerio.load(listText);
      
      // テーブルなどからエントリIDを抽出
      const entryIds: number[] = [];
      $list('tr.entry').each((_, row) => {
        const id = $(row).attr('id');
        if (id) {
          const match = id.match(/\d+/);
          if (match) entryIds.push(parseInt(match[0], 10));
        }
      });
      
      // 各エントリをパース（今回は最新10件程度に制限するか、全件回す）
      for (const entryId of entryIds.slice(0, 15)) {
        const entryRes = await fetch(`${CMS_URL}?__mode=view&_type=entry&blog_id=${blog.id}&id=${entryId}`, { headers });
        const entryText = await entryRes.text();
        const $entry = cheerio.load(entryText);
        
        const title = $entry('input[name="title"]').val() as string || '';
        const statusEl = $entry('select[name="status"] option:selected');
        const status = statusEl.text().trim() || '公開';
        const cat_ids = $entry('input[name="category_ids"]').val() as string || null;
        
        // 詳細フィールド
        const petNumber = $entry('input[name="text01"]').val() as string || '';
        const breed = $entry('input[name="text07"]').val() as string || '';
        const color = $entry('textarea[name="textarea04"]').text() || '';
        const gender = $entry('input[name="genderselect"]:checked').val() as string || '';
        const birthDate = $entry('textarea[name="textarea03"]').text() || '';
        const origin = $entry('textarea[name="textarea02"]').text() || '';
        
        const priceText = $entry('textarea[name="textarea09"]').text() || '';
        let price = null;
        const priceMatch = priceText.match(/([\d,]+)円/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
        
        const vaccine = $entry('textarea[name="textarea05"]').text() || '';
        const packContent = $entry('textarea[name="textarea06"]').text() || '';
        
        const pet_number_clean = petNumber.replace('お問い合わせ番号', '').trim();
        
        // 画像は 일단 null (後日画像URLが取れる箇所を特定したら追加)
        const imageUrl = null;

        await supabase.from('cms_pets').upsert({
          entry_id: entryId,
          blog_id: blog.id,
          status,
          title,
          category_ids: cat_ids,
          pet_number: pet_number_clean,
          species: blog.type,
          breed,
          color,
          gender,
          birth_date: birthDate,
          origin,
          price,
          vaccine_status: vaccine,
          pack_content: packContent,
          image_url: imageUrl,
          updated_at: new Date().toISOString()
        }, { onConflict: 'entry_id, blog_id' });
        
        processedCount++;
      }
    }

    return { success: true, count: processedCount, message: `${processedCount} 件の生体データを同期しました` };
  } catch (error: any) {
    console.error('Sync Error:', error);
    return { success: false, message: error.message };
  }
}
