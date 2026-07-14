/**
 * 1日1回、生体情報の自動同期APIをセキュアに叩くための Google Apps Script トリガー用関数
 * 
 * 【設定手順】
 * 1. Google スプレッドシート等の拡張機能メニューから「Apps Script」を開きます。
 * 2. 本スクリプトを貼り付け、ご自身のドメイン (YOUR_APP_DOMAIN) とシークレット (YOUR_CRON_SECRET_TOKEN) を書き換えます。
 * 3. 左側の時計マーク（トリガー）メニューから「トリガーを追加」を選択します。
 * 4. 実行する関数: `triggerDailySync`
 *    イベントのソース: 「時間主導型」
 *    トリガーのタイプ: 「日ベースのタイマー」
 *    時間帯: 「午前4時〜5時」などアクセスが少ない時間帯に設定し、保存します。
 */
function triggerDailySync() {
  // 本番環境のNext.jsドメイン (例: my-dashboard.vercel.app や独自ドメイン)
  const domain = "YOUR_APP_DOMAIN"; 
  
  // 本番環境の環境変数 CRON_SECRET に設定したトークンと同じ文字列
  const cronSecret = "YOUR_CRON_SECRET_TOKEN"; 

  const url = "https://" + domain + "/api/cron/sync";
  const options = {
    "method": "get",
    "headers": {
      "Authorization": "Bearer " + cronSecret
    },
    "muteHttpExceptions": true // エラー時にも処理を止めずに例外ログを残す
  };

  try {
    console.log("定期同期APIを呼び出します: " + url);
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    console.log("HTTPステータスコード: " + responseCode);
    console.log("レスポンス内容: " + responseBody);
    
    if (responseCode === 200) {
      console.log("定期同期が正常に完了しました。");
    } else {
      console.error("同期が失敗しました。レスポンスを確認してください。");
    }
  } catch (error) {
    console.error("APIの呼び出し中にエラーが発生しました: " + error.toString());
  }
}
