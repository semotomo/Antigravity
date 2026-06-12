'use server';

import { createClient } from '../supabase/server';
import * as cheerio from 'cheerio';
import { Database } from '../types/database';

const CMS_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi";
const USERNAME = process.env.CMS_USERNAME || "manager";
const PASSWORD = process.env.CMS_PASSWORD || "Wn3fyuVTa9";

export async function syncPetsData() {
  const supabase = await createClient();

  try {
    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0');
    // ベーシック認証ヘッダー
    const authString = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    headers.set('Authorization', `Basic ${authString}`);

    // 1. ダッシュボードへアクセスしてクッキーとフォーム情報を取得
    const dashRes = await fetch(`${CMS_URL}?__mode=dashboard`, { headers });
    if (!dashRes.ok) throw new Error(`Dashboard access failed: ${dashRes.status}`);
    
    // getSetCookie() を使って安全にクッキーを取得（カンマ誤分割バグの回避）
    const dashSetCookies = dashRes.headers.getSetCookie();
    let cookie = dashSetCookies.map(c => c.split(';')[0]).join('; ');
    if (cookie) {
      headers.set('Cookie', cookie);
    }

    let dashText = await dashRes.text();
    let $ = cheerio.load(dashText);
    
    // ログインフォームがある場合（または未ログイン状態の場合）
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
      const loginRes = await fetch(loginAction, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(headers.entries()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });
      
      const loginSetCookies = loginRes.headers.getSetCookie();
      if (loginSetCookies.length > 0) {
        const newCookies = loginSetCookies.map(c => c.split(';')[0]).join('; ');
        cookie = cookie ? `${cookie}; ${newCookies}` : newCookies;
        headers.set('Cookie', cookie);
      }

      // ログイン後のクッキーを反映してダッシュボードを再取得
      const dashRes2 = await fetch(`${CMS_URL}?__mode=dashboard`, { headers });
      dashText = await dashRes2.text();
      $ = cheerio.load(dashText);
    }

    // ログイン成否の厳密なチェック
    const isLoggedIn = dashText.includes('サインアウト') || dashText.includes('manager') || dashText.includes('からつケンネル');
    if (!isLoggedIn) {
      const title = $('title').text() || 'No Title';
      const bodyPreview = $('body').text().substring(0, 200).replace(/\s+/g, ' ');
      throw new Error(`CMSログイン失敗 (サーバー制限の可能性あり) - Title: ${title}, Content: ${bodyPreview}`);
    }

    // 2. 犬と猫のデータ取得 (blog_id=73, 82)
    const blogs = [
      { id: 73, type: '犬' },
      { id: 82, type: '猫' }
    ];

    let processedCount = 0;

    for (const blog of blogs) {
      // 一覧HTMLからmagic_tokenを取得
      const listRes = await fetch(`${CMS_URL}?__mode=list&_type=entry&blog_id=${blog.id}`, { headers });
      const listText = await listRes.text();
      const $list = cheerio.load(listText);
      const token = $list('input[name="magic_token"]').val() as string || '';

      // APIからエントリ一覧を取得
      const reqData = new URLSearchParams();
      reqData.append('__mode', 'filtered_list');
      reqData.append('datasource', 'entry');
      reqData.append('blog_id', String(blog.id));
      reqData.append('limit', '50');
      reqData.append('sort_by', 'modified_on');
      reqData.append('sort_direction', 'descend');
      reqData.append('sort_order', 'descend');
      if (token) reqData.append('magic_token', token);

      const apiRes = await fetch(CMS_URL, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(headers.entries()),
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
          console.error('Failed to parse filtered_list json:', e);
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

      // 各エントリをパース
      for (const entryId of entryIds.slice(0, 30)) {
        const entryRes = await fetch(`${CMS_URL}?__mode=view&_type=entry&blog_id=${blog.id}&id=${entryId}`, { headers });
        const entryText = await entryRes.text();
        const $entry = cheerio.load(entryText);

        const title = $entry('input[name="title"]').val() as string || '';
        const statusEl = $entry('select[name="status"] option:selected');
        const status = statusEl.text().trim() || '公開';
        const cat_ids = $entry('input[name="category_ids"]').val() as string || null;

        // 詳細フィールドのパース
        const petNumber = ($entry('input[name="text01"]').val() as string || $entry('input[name="text01"]').text() || '').trim();
        const breed = ($entry('input[name="text07"]').val() as string || $entry('input[name="text07"]').text() || '').trim();
        const color = ($entry('textarea[name="textarea04"]').val() as string || $entry('textarea[name="textarea04"]').text() || '').trim();
        
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
        // 生年月日 (例: "2026年1月25日" を "2026-01-25" にフォーマット変換)
        let formattedBirthDate = null;
        if (birthDateText) {
          const dateMatch = birthDateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          if (dateMatch) {
            const y = dateMatch[1];
            const m = dateMatch[2].padStart(2, '0');
            const d = dateMatch[3].padStart(2, '0');
            formattedBirthDate = `${y}-${m}-${d}`;
          } else {
            formattedBirthDate = birthDateText; // フォーマット不一致時は文字列そのまま
          }
        }

        const origin = ($entry('textarea[name="textarea02"]').val() as string || $entry('textarea[name="textarea02"]').text() || '').trim();

        // 価格のパース (税込・税抜の抽出)
        const priceText = ($entry('textarea[name="textarea09"]').val() as string || $entry('textarea[name="textarea09"]').text() || '').trim();
        let priceExcludingTax = null;
        let priceIncludingTax = null;
        
        if (priceText) {
          const cleanPriceText = priceText.replace(/<[^>]*>/g, '').replace(/,/g, '');
          const exMatch = cleanPriceText.match(/(\d+)円/);
          if (exMatch) {
            priceExcludingTax = parseInt(exMatch[1], 10);
          }
          const incMatch = cleanPriceText.match(/税込(\d+)円?/);
          if (incMatch) {
            priceIncludingTax = parseInt(incMatch[1], 10);
          }
        }

        const vaccine = ($entry('textarea[name="textarea05"]').val() as string || $entry('textarea[name="textarea05"]').text() || '').trim();
        const packContent = ($entry('textarea[name="textarea06"]').val() as string || $entry('textarea[name="textarea06"]').text() || '').trim();

        // 生体番号（お問合せ番号）の抽出 (6桁の数字を抽出)
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

        // 画像URLの取得
        let imageUrl: string | null = $entry('input[name="og_image_url"]').val() as string || null;
        if (!imageUrl) {
          imageUrl = $entry('#og_image_img').attr('src') || null;
        }

        // 店舗IDの判定ヘルパー関数
        const getStoreIdFromCategoryIds = (categoryIdsStr: string | null): number | null => {
          if (!categoryIdsStr) return null;
          const ids = categoryIdsStr.split(',').map(id => id.trim());
          const mapping: { [cmsCategoryId: string]: number } = {
            '379': 7, // karatsu -> 本店
            '380': 2, // pets-max -> マックス
            '381': 6, // pet-center -> わんわん
            '414': 5, // susenji -> 周船寺
            '426': 3, // imari -> 伊万里
            '425': 1, // sasebo -> 佐世保
            '432': 4, // takeo -> 武雄
          };
          for (const id of ids) {
            if (mapping[id]) return mapping[id];
          }
          return null;
        };

        const storeId = getStoreIdFromCategoryIds(cat_ids);

        const petData: Database['public']['Tables']['cms_pets']['Insert'] = {
          cms_entry_id: entryId,
          publish_status: status,
          cms_category_ids: cat_ids,
          management_no: pet_number_clean || `UNKNOWN-${entryId}`,
          species: blog.type,
          breed: breed || title.replace(/\b(\d{6})\b/g, '').replace('お問い合わせ番号', '').trim(),
          coat_color: color || null,
          gender: gender || null,
          birth_date: formattedBirthDate,
          birth_place: origin || null,
          price_tax_excluded: priceExcludingTax,
          price_tax_included: priceIncludingTax,
          vaccines: vaccine || null,
          image_url: imageUrl || null,
          store_id: storeId,
          cms_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error: upsertErr } = await supabase.from('cms_pets').upsert(petData as any, { onConflict: 'cms_entry_id' });
        if (upsertErr) {
          console.error(`Failed to upsert pet entry_id ${entryId}:`, upsertErr);
          throw new Error(`DB書き込み失敗 (EntryID: ${entryId}): ${upsertErr.message}`);
        }

        processedCount++;
      }
    }

    return { success: true, count: processedCount, message: `${processedCount} 件の生体データを同期しました` };
  } catch (error: any) {
    console.error('Sync Error:', error);
    return { success: false, message: error.message };
  }
}
