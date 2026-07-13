'use server';

import { createClient } from '../supabase/server';
import * as cheerio from 'cheerio';
import { Database } from '../types/database';

const CMS_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi";
const USERNAME = process.env.CMS_USERNAME || "manager";
const PASSWORD = process.env.CMS_PASSWORD || "Wn3fyuVTa9";

// リトライ機能付き fetch ヘルパー関数
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      // 一時的な高負荷エラー (503 / 429) もリトライ対象にする
      if (res.status === 503 || res.status === 429) {
        throw new Error(`HTTP Status ${res.status}`);
      }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`Fetch failed (attempt ${i + 1}/${retries}), retrying in ${delayMs * (i + 1)}ms...`, e);
      // バックオフディレイを挟んで再試行
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw new Error('Fetch failed after retries');
}

// 店舗IDの判定ヘルパー関数
const getStoreIdFromCategoryIds = (categoryIds: string[]): number | null => {
  const mapping: { [cmsCategoryId: string]: number } = {
    '379': 7, // karatsu -> 本店
    '380': 2, // pets-max -> マックス (ペッツマックス唐津店)
    '381': 6, // pet-center ->わんわん (わんわんペットセンター)
    '414': 5, // susenji -> 周船寺
    '426': 3, // imari -> 伊万里
    '425': 1, // sasebo -> 佐世保
    '432': 4, // takeo -> 武雄
  };
  for (const id of categoryIds) {
    if (mapping[id]) return mapping[id];
  }
  return null;
};

export async function syncPetsData(mode: 'quick' | 'full' = 'quick') {
  const supabase = await createClient();
  const syncedEntryIds: number[] = [];

  // 動的フィルター用の日付範囲算出
  let fromDate = '';
  let toDate = '';

  if (mode === 'quick') {
    try {
      const { data: latestPet, error: latestErr } = await supabase
        .from('cms_pets')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);

      const formatJstDate = (date: Date) => {
        const jstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        const y = jstDate.getFullYear();
        const m = String(jstDate.getMonth() + 1).padStart(2, '0');
        const d = String(jstDate.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };

      const baseDate = new Date();
      const latestPetTyped = latestPet as { updated_at: string | null }[] | null;
      if (!latestErr && latestPetTyped && latestPetTyped.length > 0 && latestPetTyped[0].updated_at) {
        baseDate.setTime(new Date(latestPetTyped[0].updated_at).getTime());
      } else {
        baseDate.setDate(baseDate.getDate() - 7);
      }

      // 安全マージンとして最終同期の1日前から本日までを対象範囲とする
      const fromDateObj = new Date(baseDate);
      fromDateObj.setDate(fromDateObj.getDate() - 1);
      
      fromDate = formatJstDate(fromDateObj);
      toDate = formatJstDate(new Date());

      console.log(`Quick sync date filter applied: from ${fromDate} to ${toDate}`);
    } catch (e) {
      console.error('Failed to calculate sync date range:', e);
    }
  }

  try {
    // 1. CMSログイン処理 (リトライ機能付き接続)
  let loginHeaders = new Headers();
  let cookie = '';
  try {
    loginHeaders.set('User-Agent', 'Mozilla/5.0');
    const authString = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    loginHeaders.set('Authorization', `Basic ${authString}`);

    const dashRes = await fetchWithRetry(`${CMS_URL}?__mode=dashboard`, { headers: loginHeaders });
    if (!dashRes.ok) throw new Error(`Dashboard access failed: ${dashRes.status}`);
    
    const dashSetCookies = dashRes.headers.getSetCookie();
    cookie = dashSetCookies.map(c => c.split(';')[0]).join('; ');
    if (cookie) {
      loginHeaders.set('Cookie', cookie);
    }

    let dashText = await dashRes.text();
    let $ = cheerio.load(dashText);

    const form = $('form').first();
    const action = form.attr('action') || '';
    if (action.includes('login') || dashText.includes('name="magic_token"') || !dashText.includes('サインアウト')) {
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
      const loginRes = await fetchWithRetry(loginAction, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(loginHeaders.entries()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });
      
      const loginSetCookies = loginRes.headers.getSetCookie();
      if (loginSetCookies.length > 0) {
        const newCookies = loginSetCookies.map(c => c.split(';')[0]).join('; ');
        cookie = cookie ? `${cookie}; ${newCookies}` : newCookies;
        loginHeaders.set('Cookie', cookie);
      }

      const dashRes2 = await fetchWithRetry(`${CMS_URL}?__mode=dashboard`, { headers: loginHeaders });
      dashText = await dashRes2.text();
      $ = cheerio.load(dashText);
    }

    const isLoggedIn = dashText.includes('サインアウト') || dashText.includes('manager') || dashText.includes('からつケンネル');
    if (!isLoggedIn) {
      const title = $('title').text() || 'No Title';
      const bodyPreview = $('body').text().substring(0, 200).replace(/\s+/g, ' ');
      throw new Error(`CMSログイン失敗 - Title: ${title}, Content: ${bodyPreview}`);
    }
  } catch (loginErr: any) {
    console.error('CMS Login failed:', loginErr);
    return { success: false, message: `CMSログイン失敗: ${loginErr.message}` };
  }

  // 2. 犬と猫のデータ取得 (blog_id=73:犬, 82:猫) を独立処理
  const blogs = [
    { id: 73, type: '犬' },
    { id: 82, type: '猫' }
  ];

  const limitVal = mode === 'quick' ? '50' : '500';
  const loopLimit = mode === 'quick' ? 50 : 500;
  let processedCount = 0;
  let blogIndex = 0;

  for (const blog of blogs) {
    // 2回目以降のブログ処理開始前に、安全のために1秒ウェイトを挟む
    if (blogIndex > 0) {
      console.log(`[接続制限回避] 1秒待機してからブログ ID ${blog.id} (${blog.type}) の処理を開始します...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    blogIndex++;

    try {
      const blogPetData: Database['public']['Tables']['cms_pets']['Insert'][] = [];
      const blogNonPublicEntryIdsToDelete: number[] = [];

      console.log(`[同期開始] ブログ ID: ${blog.id} (${blog.type})`);

      // 一覧HTMLからmagic_tokenを取得
      const listRes = await fetchWithRetry(`${CMS_URL}?__mode=list&_type=entry&blog_id=${blog.id}`, { headers: loginHeaders });
      const listText = await listRes.text();
      const $list = cheerio.load(listText);
      const token = $list('input[name="magic_token"]').val() as string || '';

      // APIからエントリ一覧を取得
      const reqData = new URLSearchParams();
      reqData.append('__mode', 'filtered_list');
      reqData.append('datasource', 'entry');
      reqData.append('blog_id', String(blog.id));
      reqData.append('limit', limitVal);
      reqData.append('sort_by', 'modified_on');
      reqData.append('sort_direction', 'descend');
      reqData.append('sort_order', 'descend');
      if (token) reqData.append('magic_token', token);

      if (mode === 'quick' && fromDate && toDate) {
        const filterItems = [
          {
            type: 'modified_on',
            args: {
              option: 'range',
              from: fromDate,
              to: toDate
            }
          }
        ];
        reqData.append('items', JSON.stringify(filterItems));
      }

      const apiRes = await fetchWithRetry(CMS_URL, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(loginHeaders.entries()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: reqData.toString()
      });

      const entryIds: number[] = [];
      if (apiRes.ok) {
        try {
          const data = await apiRes.json() as any;
          if (data?.result?.objects) {
            for (const obj of data.result.objects) {
              const entryId = obj[0];
              if (entryId && !isNaN(Number(entryId))) {
                entryIds.push(Number(entryId));
              }
            }
          }
        } catch (e) {
          console.error(`Failed to parse filtered_list json for ${blog.type}:`, e);
        }
      }

      // フォールバック: HTML上のAタグからID抽出
      if (entryIds.length === 0) {
        $list('a').each((_, el) => {
          const href = $list(el).attr('href') || '';
          if (href.includes('__mode=view') && href.includes('id=')) {
            const match = href.match(/id=(\d+)/);
            if (match) {
              const id = parseInt(match[1], 10);
              if (!entryIds.includes(id)) entryIds.push(id);
            }
          }
        });
      }

      console.log(`ブログ ${blog.type}: ${entryIds.length} 件のエントリを検出しました。同期を実行します。`);

      // 各エントリをパース
      for (const entryId of entryIds.slice(0, loopLimit)) {
        try {
          // 接続遮断制限を避けるために詳細リクエスト間に 150ms のウェイトを置く
          await new Promise(resolve => setTimeout(resolve, 150));

          const entryRes = await fetchWithRetry(`${CMS_URL}?__mode=view&_type=entry&blog_id=${blog.id}&id=${entryId}`, { headers: loginHeaders });
          const entryText = await entryRes.text();
          const $entry = cheerio.load(entryText);

          const title = $entry('input[name="title"]').val() as string || '';
          
          // ステータス制限: '2'(公開) 以外のものは同期をスキップし、DBからも削除する
          const statusVal = $entry('select[name="status"]').val() as string || '';
          if (statusVal !== '2') {
            blogNonPublicEntryIdsToDelete.push(entryId);
            continue;
          }

          // 販売終了チェックボックス (checkboxoff01_acf)
          const isSoldOut = $entry('input[name="checkboxoff01_acf"]').prop('checked') || 
                            $entry('input[name="checkboxoff01_acf"]').attr('checked') !== undefined;
          const status = isSoldOut ? '販売終了' : '公開';

          // カテゴリIDの抽出
          const checkedCats: string[] = [];
          $entry('input[name^="add_category_id_"]').each((_, el) => {
            if ($entry(el).attr('checked') !== undefined || $entry(el).prop('checked')) {
              const name = $entry(el).attr('name') || '';
              const match = name.match(/add_category_id_(\d+)/);
              if (match) {
                checkedCats.push(match[1]);
              }
            }
          });
          
          const cat_ids_val = $entry('input[name="category_ids"]').val() as string || '';
          if (cat_ids_val) {
            cat_ids_val.split(',').forEach(id => {
              const tid = id.trim();
              if (tid && !checkedCats.includes(tid)) checkedCats.push(tid);
            });
          }

          const petNumber = ($entry('input[name="text01"]').val() as string || $entry('input[name="text01"]').text() || '').trim();
          const breed = ($entry('input[name="text07"]').val() as string || $entry('input[name="text07"]').text() || '').trim();
          const color = ($entry('textarea[name="textarea04"]').val() as string || $entry('textarea[name="textarea04"]').text() || '').trim();
          const authoredOnDate = $entry('input[name="authored_on_date"]').val() as string || '';
          const authoredOnTime = $entry('input[name="authored_on_time"]').val() as string || '';

          let gender = '';
          const genderVal = $entry('input[name="genderselect"]:checked').val() as string || '';
          if (genderVal) {
            gender = genderVal;
          } else {
            $entry('input[name="genderselect"]').each((_, el) => {
              if ($entry(el).attr('checked') !== undefined) {
                gender = $entry(el).val() as string;
              }
            });
          }

          const birthDateText = ($entry('textarea[name="textarea03"]').val() as string || $entry('textarea[name="textarea03"]').text() || '').trim();
          let formattedBirthDate = null;
          if (birthDateText) {
            const digits = birthDateText.match(/\d+/g);
            if (digits && digits.length >= 3) {
              const y = digits[0];
              const m = digits[1].padStart(2, '0');
              const d = digits[2].padStart(2, '0');
              const year = parseInt(y, 10);
              const month = parseInt(m, 10);
              const day = parseInt(d, 10);
              if (year > 2000 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                formattedBirthDate = `${y}-${m}-${d}`;
              }
            }
          }

          const origin = ($entry('textarea[name="textarea02"]').val() as string || $entry('textarea[name="textarea02"]').text() || '').trim();

          const priceTextRaw = ($entry('textarea[name="textarea09"]').val() as string || $entry('textarea[name="textarea09"]').text() || '').trim();
          let priceExcludingTax = null;
          let priceIncludingTax = null;
          let priceDisplay = null;
          
          if (priceTextRaw) {
            const cleanPriceText = priceTextRaw.replace(/<[^>]*>/g, '');
            priceDisplay = cleanPriceText.trim();

            const cleanNumbersOnly = priceTextRaw.replace(/,/g, '');

            const numbersExcludingTax = [];
            const regexEx = /(\d+)円/g;
            let matchEx;
            while ((matchEx = regexEx.exec(cleanNumbersOnly)) !== null) {
              numbersExcludingTax.push(parseInt(matchEx[1], 10));
            }
            if (numbersExcludingTax.length > 0) {
              priceExcludingTax = numbersExcludingTax[numbersExcludingTax.length - 1];
            }

            const numbersIncludingTax = [];
            const regexInc = /税込(\d+)円?/g;
            let matchInc;
            while ((matchInc = regexInc.exec(cleanNumbersOnly)) !== null) {
              numbersIncludingTax.push(parseInt(matchInc[1], 10));
            }
            if (numbersIncludingTax.length > 0) {
              priceIncludingTax = numbersIncludingTax[numbersIncludingTax.length - 1];
            } else {
              const regexInc2 = /\(税込(\d+)円?\)/g;
              let matchInc2;
              while ((matchInc2 = regexInc2.exec(cleanNumbersOnly)) !== null) {
                numbersIncludingTax.push(parseInt(matchInc2[1], 10));
              }
              if (numbersIncludingTax.length > 0) {
                priceIncludingTax = numbersIncludingTax[numbersIncludingTax.length - 1];
              }
            }
          }

          const vaccine = ($entry('textarea[name="textarea05"]').val() as string || $entry('textarea[name="textarea05"]').text() || '').trim();

          let pet_number_clean = '';
          const m_no = title.match(/\b(\d{6})\b/);
          if (m_no) {
            pet_number_clean = m_no[1];
          } else {
            const m_no2 = petNumber.match(/\b(\d{6})\b/);
            if (m_no2) {
              pet_number_clean = m_no2[1];
            } else {
              const numOnly = petNumber.replace(/\D/g, '');
              if (numOnly.length >= 5 && numOnly.length <= 8) {
                pet_number_clean = numOnly;
              } else {
                pet_number_clean = petNumber.replace('お問い合わせ番号', '').trim();
              }
            }
          }

          let imageUrl: string | null = null;
          for (let i = 1; i <= 30; i++) {
            const numStr = String(i).padStart(2, '0');
            const previewImg = $entry(`#acf_image${numStr}_preview img`);
            if (previewImg.length > 0) {
              imageUrl = previewImg.attr('src') || null;
              if (imageUrl) break;
            }
          }
          if (!imageUrl) imageUrl = $entry('input[name="og_image_url"]').val() as string || null;
          if (!imageUrl) imageUrl = $entry('#og_image_img').attr('src') || null;
          if (imageUrl && imageUrl.startsWith('/')) {
            imageUrl = `https://www.pets-kennel.com${imageUrl}`;
          }

          const storeId = getStoreIdFromCategoryIds(checkedCats);

          let cmsUpdatedAtIso = new Date().toISOString();
          if (authoredOnDate && authoredOnTime) {
            const jstStr = `${authoredOnDate}T${authoredOnTime}+09:00`;
            const d = new Date(jstStr);
            if (!isNaN(d.getTime())) {
              cmsUpdatedAtIso = d.toISOString();
            }
          }

          const petData: Database['public']['Tables']['cms_pets']['Insert'] = {
            cms_entry_id: entryId,
            publish_status: status,
            cms_category_ids: checkedCats.join(','),
            management_no: pet_number_clean || `UNKNOWN-${entryId}`,
            species: blog.type,
            breed: breed || title.replace(/\b(\d{6})\b/g, '').replace('お問い合わせ番号', '').trim(),
            coat_color: color || null,
            gender: gender || null,
            birth_date: formattedBirthDate,
            birth_place: origin || null,
            price_tax_excluded: priceExcludingTax,
            price_tax_included: priceIncludingTax,
            price_text: priceDisplay,
            vaccines: vaccine || null,
            image_url: imageUrl || null,
            store_id: storeId,
            cms_updated_at: cmsUpdatedAtIso,
            updated_at: new Date().toISOString()
          };

          blogPetData.push(petData);
          syncedEntryIds.push(entryId);
        } catch (entryErr) {
          console.error(`Failed to parse entry ID ${entryId} for ${blog.type}:`, entryErr);
        }
      }

      // ブログ（犬・猫）単位でのSupabaseへの独立した書き込み
      if (blogNonPublicEntryIdsToDelete.length > 0) {
        console.log(`Deleting ${blogNonPublicEntryIdsToDelete.length} non-public entries for ${blog.type}...`);
        await supabase
          .from('cms_pets')
          .delete()
          .in('cms_entry_id', blogNonPublicEntryIdsToDelete);
      }

      if (blogPetData.length > 0) {
        console.log(`Upserting ${blogPetData.length} records for ${blog.type} into DB...`);
        const { error: upsertErr } = await supabase
          .from('cms_pets')
          .upsert(blogPetData as any, { onConflict: 'cms_entry_id' });
        
        if (upsertErr) {
          console.error(`Failed to upsert data for ${blog.type}:`, upsertErr);
          throw new Error(`DB書き込み失敗 (${blog.type}): ${upsertErr.message}`);
        }
        processedCount += blogPetData.length;
      }

      console.log(`[同期成功] ブログ ID: ${blog.id} (${blog.type}) - ${blogPetData.length}件保存完了`);
    } catch (blogErr: any) {
      console.error(`Blog sync failed for ${blog.type}:`, blogErr);
      // 片方のブログでエラーが発生しても処理を継続させる
    }
  }

  // 3. フル同期時の古いレコードの一括クリーンアップ削除 (全ブログ処理の完了後に安全に実行)
  if (mode === 'full' && syncedEntryIds.length > 0) {
    try {
      console.log(`[クリーンアップ] フル同期用の古いレコードの一括削除を実行します...`);
      const { error: deleteErr } = await supabase
        .from('cms_pets')
        .delete()
        .in('species', ['犬', '猫'])
        .not('cms_entry_id', 'in', `(${syncedEntryIds.join(',')})`);
      if (deleteErr) {
        console.error('Failed to batch delete old pets:', deleteErr);
      }
    } catch (cleanErr) {
      console.error('Clean up failed:', cleanErr);
    }
  }

  return { 
    success: true, 
    count: processedCount, 
    message: `${processedCount} 件の生体データを同期しました` + (mode === 'full' ? '（古いデータの削除完了）' : '') 
  };
} catch (error: any) {
  console.error('Sync Error:', error);
  return { success: false, message: error.message };
}
}
