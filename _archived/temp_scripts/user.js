(function($){
	//$.MTAppDebug();

	////////// 初期値設定 //////////
	// タイトルを管理画面でしか使わない場合の表示内容

	//（サイト管理）サイト共通 - システム管理者用 の値を
	//CmsTemplate プラグインにて、管理画面のヘッダに javaScript 変数として埋込
	//その値をここで読み込んで使用
	var basicBodyAndMoreType = cmsBasicBodyAndMoreType;

	var titleLabelNotUse = 'タイトル (管理画面用 : サイトには反映されません)';
	var titleHintNotUse = 'ここで入力した内容は、管理画面のみで使用し、サイトには反映されません';

	var basicBodyAndMoreShow = 'show';

	var basicBodyName = 'PC';
	var basicBodyHint = '「PC／モバイル」別々に表示する内容を入力できます。「モバイル」に入力がない場合には「PC」の内容がモバイルサイトに表示されます。';
	var basicBodyShow = 'show';

	var basicMoreName = 'モバイル';
	var basicMoreShow = 'show';

	///// タイプによって設定変更 /////
	///// タイプによって設定変更 /////
	if(basicBodyAndMoreType == 'PCのみ' || basicBodyAndMoreType == 'モバイルのみ'){
		//PC、モバイル片方しか使用しない場合は、本文のみ表示
		var basicBodyName = '本文';
		var basicBodyHint = '';

		var basicMoreName = '';
		var basicMoreShow = 'hide';
	}


	////////// その他カスタマイズ //////////

	///// コメント・フィードバック を非表示 /////
	if(mtappVars.author_id != 1){ //管理者は除外
		//右カラムから削除
		$('#menu-feedback').remove();
		//削除した内容が最後にあった場合を考慮し、クラスを追加
		$('#website-wide-menu li:last-child').addClass('last-child');

		//システム・Webサイトのトップページに表示されるブログの一覧から削除
		$(".blog-control li").each(function(){
			if($(this).html().match('(コメント|ページ)')){ //ページもついでに削除
				$(this).remove();
			}
		});
	}

	///// 追加フィールド・表示設定 /////
	//不要なフィールドを非表示にする

	// エントリー 共通設定
	if(mtappVars.screen_id == 'edit-entry'){
		$('BODY#edit-entry #display-options #entry_fields-field').hide();//カスタムフィールド表示オプション 非表示
		$('BODY#edit-entry #main-content div.field').hide();//一度、全てのフィールドをすべて非表示

		//カスタムフィールド非表示時、一緒に消えてしまったデフォルトの要素を戻す
		$('BODY#edit-entry #main-content #entry-body-field').show(); //本文+追記
		$('BODY#edit-entry #main-content #keywords-field').show(); //本文+追記

		//ヒントを設定
		$.MTAppCustomize({
			basename:   'systitle',
			//label:      '',
			hint:       '入力した内容で、 title が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'syskeywords',
			//label:      '',
			hint:       '入力した内容で、 keywords が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysdescription',
			//label:      '',
			hint:       '入力した内容で、 description が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysh1',
			//label:      '',
			hint:       '入力した内容で、 h1 が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysh2',
			//label:      '',
			hint:       '入力した内容にて、新しい H2 が追加されます。'
		});
	}

	//カテゴリ 共通設定
	if(mtappVars.screen_id == 'edit-category'){
		$('BODY#edit-category #main-content #category-meta div.field').hide();//一度、全てのフィールドをすべて非表示

		//一緒に消えてしまったデフォルトの要素を戻す
		$('BODY#edit-category #main-content #category-meta div#label-field').show();
		$('BODY#edit-category #main-content #category-meta div#basename-field').show();

		//ヒントを設定
		$.MTAppCustomize({
			basename:   'systitlecat',
			//label:      '',
			hint:       '入力した内容で、 title が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'syskeywordscat',
			//label:      '',
			hint:       '入力した内容で、 keywords が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysdescriptioncat',
			//label:      '',
			hint:       '入力した内容で、 description が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysh1cat',
			//label:      '',
			hint:       '入力した内容で、 h1 が置換されます。'
		});
	}

	//ブログ 共通設定
	if(mtappVars.screen_id == 'edit-blog'){
		$('BODY#edit-blog #main-content #blog-settings div.field').hide();//一度、全てのフィールドをすべて非表示

		//一緒に消えてしまったデフォルトの要素を戻す
		$('BODY#edit-blog #main-content #language-field div.field').show();
		$('BODY#edit-blog #main-content #publushing-path-settings div.field').show();
		$('BODY#edit-blog #main-content #archive-option-settings div.field').show();
		$('BODY#edit-blog #main-content #module-option-settings div.field').show();
		$('BODY#edit-blog #main-content #revision-history-settings div.field').show();
		$('BODY#edit-blog #main-content #open-graph-settings div.field').show();

		//ヒントを設定
		$.MTAppCustomize({
			basename:   'systitleblog',
			//label:      '',
			hint:       '入力した内容で、 title が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'syskeywordsblog',
			//label:      '',
			hint:       '入力した内容で、 keywords が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysdescriptionblog',
			//label:      '',
			hint:       '入力した内容で、 description が置換されます。'
		});
		$.MTAppCustomize({
			basename:   'sysh1blog',
			//label:      '',
			hint:       '入力した内容で、 h1 が置換されます。'
		});
	}

	////////// ブログ カテゴリのデフォルト設定 //////////
	var categoryDefInsetId = 'category-meta'; //カスタムフィールド挿入位置
	var categoryDefSortBefore = 'label,basename';//カスタムフィールドの前に表示する要素
	var categoryDefSortAfter = '';//カスタムフィールドの後に表示する要素

	var blogDefInsetId = 'blog-settings'; //カスタムフィールド挿入位置
	var blogDefSortBefore = 'name';//カスタムフィールドの前に表示する要素
	var blogDefSortAfter = ',server_offset,has-license';//カスタムフィールドの後に表示する要素



	///// ブログごとの設定 /////

	/// （サイト管理）サイト共通 - システム管理者用 ///
	if(blogID == 1){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,textarea01,image01,cmnsitemainmenupos,image02,textarea02,checkboxon01,checkboxon02,text02,textarea03,textarea04,text03,text04,text05,cmntypepcmob,cmnblogdeleteflag,cmnpubdatevisible,checkboxon03'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      'PC : ヘッダ : h1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'PC : ヘッダ : 連絡先',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      'PC : ヘッダ : ロゴ画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'cmnsitemainmenupos',
			label:      '',
			hint:       'メインメニューをキャッチ画像の上下どちらに表示するかを設定します。'
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      'PC : サイドパーツ : QRコード',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'PC : フッター : フリースペース',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      'PC : フッター : サイトマップを表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon02',
			label:      'PC : フッター : プライバシーポリシーを表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'PC : フッター : Copyright',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      'PC : フッター : googleAnalytics挿入',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'PC : Google Maps API key',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'ソーシャルボタン js 読み込み元 URL',
			hint:       '外部ドメインから javaScript を読み込むときのみ、入力してください。マネージドサーバ使用時 http://ドメイン名/cmn/js/jquery.socialbutton.js'
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'mixi 認証キー',
			hint:       'mixi ボタンを表示する際に、入力してください。'
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'PC : METAタグ挿入',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon03',
			label:      'システム : メールフォーム ログ保存',
			hint:       ''
		});
	}

	/// （サイト管理）携帯サイト共通 ///
	if(blogID == 29){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// （サイト管理）サイト共通 ///
	if(blogID == 26){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,text02,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      'title',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'keywords',
			hint:       'キーワードをカンマ( , )区切りで入力してください。'
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'description',
			hint:       ''
		});
	}

	/// （サイト管理）携帯サイト共通 ///
	if(blogID == 30){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,textarea01,textarea02,checkboxon01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      'ヘッダ',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      'フッタ',
			showField:  'show' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '携帯 : <head> 内タグ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '携帯 : </body> 直前タグ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      '会社概要から Copyright を出力',
			hint:       ''
		});
	}

	/// （サイト管理）スマートフォン共通  ///
	if(blogID == 42){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,text01,textarea01,textarea02,checkboxon01,checkboxoff01,checkboxoff02'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      'ヘッダ',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      'フッタ',
			showField:  'show' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      'ロゴ画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      '屋号（ロゴ画像alt用）',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'スマートフォン : head 内タグ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'スマートフォン : body 直前タグ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      '会社概要から Copyright を出力',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      'PCサイトにスマートフォンへのリンク表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      'PCサイトからスマートフォンサイトへ、遷移ポップアップ表示',
			hint:       ''
		});
	}

	/// （サイト管理）JavaScript メインイメージ ///
	if(blogID == 46){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,text01,checkboxoff01,textarea01,text11,text21,image02,text02,checkboxoff02,textarea02,text12,text22,image03,text03,checkboxoff03,textarea03,text13,text23,image04,text04,checkboxoff04,textarea04,text14,text24,image05,text05,checkboxoff05,textarea05,text15,text25,image06,text06,checkboxoff06,textarea06,text16,text26,image07,text07,checkboxoff07,textarea07,text17,text27,image08,text08,checkboxoff08,textarea08,text18,text28,jsmaintype,jsmainroop,text31,text32'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'リンクURL1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      'リンクURL1 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'HTMLを挿入1',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text11',
			label:      '表示時間1',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text21',
			label:      'エフェクト時間1',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '画像2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'リンクURL2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      'リンクURL2 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'HTMLを挿入2',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text12',
			label:      '表示時間2',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text22',
			label:      'エフェクト時間2',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '画像3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'リンクURL3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      'リンクURL3 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      'HTMLを挿入3',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text13',
			label:      '表示時間3',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text23',
			label:      'エフェクト時間3',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '画像4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'リンクURL4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      'リンクURL4 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'HTMLを挿入4',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text14',
			label:      '表示時間4',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text24',
			label:      'エフェクト時間4',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '画像5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'リンクURL5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      'リンクURL5 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'HTMLを挿入5',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text15',
			label:      '表示時間5',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text25',
			label:      'エフェクト時間5',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '画像6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'リンクURL6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      'リンクURL6 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'HTMLを挿入6',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text16',
			label:      '表示時間6',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text26',
			label:      'エフェクト時間6',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '画像7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text07',
			label:      'リンクURL7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      'リンクURL7 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'HTMLを挿入7',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text17',
			label:      '表示時間7',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text27',
			label:      'エフェクト時間7',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '画像8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text08',
			label:      'リンクURL8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      'リンクURL8 新しいウインドウで開く',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'HTMLを挿入8',
			hint:       '画像を使用せず、HTMLを表示します。「画像／リンクURL／新しいウィンドウで開く」で入力した内容は無効となります。'
		});
		$.MTAppCustomize({
			basename:   'text18',
			label:      '表示時間8',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text28',
			label:      'エフェクト時間8',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text31',
			label:      '幅',
			hint:       '単位：px'
		});
		$.MTAppCustomize({
			basename:   'text32',
			label:      '高さ',
			hint:       '単位：px'
		});
	}

	/// （サイト管理）キャッチ画像 ///
	if(blogID == 58){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,slidermainpage,checkboxon01,text01,text02,text03,text04,image01,image11,text11,checkboxoff01,image02,image12,text12,checkboxoff02,image03,image13,text13,checkboxoff03,image04,image14,text14,checkboxoff04,image05,image15,text15,checkboxoff05,image06,image16,text16,checkboxoff06,image07,image17,text17,checkboxoff07,image08,image18,text18,checkboxoff08'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      'ヘッダ',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      'フッタ',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      '前後ボタン',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      '表示時間',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'エフェクト時間',
			hint:       '単位：ミリ秒'
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      '幅',
			hint:       '単位：px'
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      '高さ',
			hint:       '単位：px'
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像1(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image11',
			label:      '画像1(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text11',
			label:      'リンクURL1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '新しいウィンドウで開く1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '画像2(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image12',
			label:      '画像2(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text12',
			label:      'リンクURL2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '新しいウィンドウで開く2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '画像3(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image13',
			label:      '画像3(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text13',
			label:      'リンクURL3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '新しいウィンドウで開く3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '画像4(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image14',
			label:      '画像4(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text14',
			label:      'リンクURL4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '新しいウィンドウで開く4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '画像5(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image15',
			label:      '画像5(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text15',
			label:      'リンクURL5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '新しいウィンドウで開く5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '画像6(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image16',
			label:      '画像6(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text16',
			label:      'リンクURL6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '新しいウィンドウで開く6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '画像7(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image17',
			label:      '画像7(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text17',
			label:      'リンクURL7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '新しいウィンドウで開く7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '画像8(メイン)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image18',
			label:      '画像8(サムネイル用)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text18',
			label:      'リンクURL8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '新しいウィンドウで開く8',
			hint:       ''
		});
	}

	/// （サイト管理）キャッチ画像 ///
	if(blogID == 27){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,catchimagetype,image01,text01,text02'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      'ヘッダ',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      'フッタ',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      'キャッチ画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      '置き換えディレクトリ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'JavaScript 出力ファイル名',
			hint:       ''
		});
	}

	/// （サイト管理）メインメニュー ///
	if(blogID == 3){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,image02,text01,text02'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      'ボタン画像(通常)',
			hint:       '通常時のボタン画像を入力します。'
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      'ボタン画像(マウスオーバー)',
			hint:       'マウスオーバー時に表示を変えたい場合、ボタン画像を入力します。'
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'alt',
			hint:       'alt 属性を入力します。(画面上に表示はされませんがSEO上有効です。)'
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'URL',
			hint:       ''
		});
	}

	/// （サイト管理）ディレクトリ条件 メインメニュー ///
	if(blogID == 48){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,dynamicmanumethod'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '条件テキスト',
			hint:       'URLから「http://ドメイン」を除いたディレクトリを判別対象とする。例)URLが http://domain.local/news/000000/ の場合、 / 以降の /news/000000/ が検索対象となります。他の条件に一致しない場合は ###defalut### と入力'
		});
	}

	/// （サイト管理）コンテンツ最下部 共通コンテンツ ///
	if(blogID == 71){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,dynamicmanumethod'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '条件テキスト',
			hint:       'URLから「http://ドメイン」を除いたディレクトリを判別対象とする。例)URLが http://domain.local/news/000000/ の場合、 / 以降の /news/000000/ が検索対象となります。他の条件に一致しない場合は ###defalut### と入力'
		});
	}

	/// （サイト管理）サイドパーツ : ディレクトリ条件 サブメニュー ///
	if(blogID == 49){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,dynamicmanumethod'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '条件テキスト',
			hint:       'URLから「http://ドメイン」を除いたディレクトリを判別対象とする。例)URLが http://domain.local/news/000000/ の場合、 / 以降の /news/000000/ が検索対象となります。他の条件に一致しない場合は ###defalut### と入力'
		});
	}

	/// （サイト管理）サイドパーツ : バナー ///
	if(blogID == 6){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,text03,text01,text02,checkboxoff01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'alt',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'リンク先概要',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'URL',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '新しいウィンドウで表示',
			hint:       ''
		});
	}

	/// （サイト管理）サイドメニュー（画像） ///
	if(blogID == 40){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,checkboxoff01,image01,image02,text02,text03'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      'URL',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '新しいウィンドウで表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      'ボタン画像（通常）',
			hint:       '通常時のボタン画像を入力します。'
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      'ボタン画像（マウスオーバー）',
			hint:       'マウスオーバー時に表示を変えたい場合、ボタン画像を入力します。'
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'alt',
			hint:       'alt 属性を入力します。(画面上に表示はされませんがSEO上有効です。)'
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      '画像下 説明文',
			hint:       '画像の他に、説明文を表示したい場合のみ入力してください。'
		});
	}

	/// （サイト管理）サイドパーツ : フリーHTML 1, 2, 3 ///
	if(blogID == 22 || blogID == 23 || blogID == 24){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent:  'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// （サイト管理）フッターメニュー ///
	if(blogID == 2){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,text02,checkboxoff01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent:  'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      'リンクタイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'URL',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '直後で改行を行う',
			hint:       'フッタメニューが長すぎる場合、直後で改行を行います'
		});
	}

	/// トップページ ///
	if(blogID == 7){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			/*showField:  basicMoreShow //「追記」タブの設定 show or hide*/
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// トップページスマートフォン ///
	if(blogID == 70){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      'SP',
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			/*showField:  basicMoreShow //「追記」タブの設定 show or hide*/
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// ブログ ケンネルジャーナル///
	if(blogID == 14){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,image01,text,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			// label:      '',
			// hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent: 'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			// label:      '',
			showField:  'show' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      'ピックアップニュースに表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      'サムネイル画像（スマートフォン トップページの最新記事に画像を表示します。PCサイトでサムネイルがある場合にも使用されます。）',
			hint:       ''
		});
	}

	/// ブログ （お知らせ：81 / イベント情報：88）///
	if(blogID == 81 || blogID == 88){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,image01,text,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			// label:      '',
			// hint:       '',
			showField:  'show', //「本文」タブの設定 show or hide,
			showParent: 'show' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			// label:      '',
			showField:  'show' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      'ピックアップニュースに表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      'サムネイル画像（スマートフォン トップページの最新記事に画像を表示します。PCサイトでサムネイルがある場合にも使用されます。）',
			hint:       ''
		});
	}

	/// プライバシーポリシー ///
	if(blogID == 10){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// 会社概要 ///
	if(blogID == 9){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,textarea01,text02,text03,textarea02,textarea03,textarea04,textarea05,textarea06,textarea07,textarea08,textarea09,textarea10,textarea11,textarea12,textarea13,textarea14,textarea15,textarea16,textarea17,textarea18,textarea19,text04,textarea20,text05,text06,textarea21,textarea22,textarea23,textarea24,textarea25,textarea26,textarea27,textarea28,textarea29,textarea30,textarea31,textarea32,textarea33,textarea34,textarea35,checkboxon01,companymaplatlon,companymobmaplatlon'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      'プロフィール 全体タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '社名',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      '所在地 : 郵便番号',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      '所在地 : 住所',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '所在地 : 住所補足',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '支社',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      '代表者',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      '設立',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      '資本金',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      '従業員数',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      '事業内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea09',
			label:      'プロフィール1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea10',
			label:      'プロフィール1 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea11',
			label:      'プロフィール2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea12',
			label:      'プロフィール2 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea13',
			label:      'プロフィール3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea14',
			label:      'プロフィール3 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea15',
			label:      'プロフィール4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea16',
			label:      'プロフィール4 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea17',
			label:      'プロフィール5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea18',
			label:      'プロフィール5 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea19',
			label:      'プロフィール 補足',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'アクセス : タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea20',
			label:      'アクセス : 説明文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'アクセス : 郵便番号',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'アクセス : 住所',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea21',
			label:      'アクセス : 住所補足',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea22',
			label:      'アクセス : TEL',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea23',
			label:      'アクセス : FAX',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea24',
			label:      'アクセス : 営業時間',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea25',
			label:      'アクセス : 定休日',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea26',
			label:      'アクセス1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea27',
			label:      'アクセス1 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea28',
			label:      'アクセス2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea29',
			label:      'アクセス2 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea30',
			label:      'アクセス3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea31',
			label:      'アクセス3 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea32',
			label:      'アクセス4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea33',
			label:      'アクセス4 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea34',
			label:      'アクセス5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea35',
			label:      'アクセス5 内容',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      'GoogleMapsを表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'companymaplatlon',
			label:      '',
			hint:       '「所在地 : 住所」または「アクセス : 住所」とは、別の位置にMAPを設定したい場合に入力します。'
		});
	}

	/// お問い合わせ ///
	if(blogID == 13){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,text02,text03,text04,textarea01,text05,textarea02,textarea03,textarea04,formitems,checkboxon01,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '電話番号',
			hint:       '数字は半角。区切り文字は - (ハイフン)で入力してください。'
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      '電話対応時間',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      '管理者メールアドレス',
			hint:       'メールフォームの送信先を入力してください。 携帯メールアドレスは設定できません。 複数のアドレスをする場合はカンマ(,)区切りで入力をしてください。'
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      '管理者宛 : 件名',
			hint:       '管理者宛に送信される、メールの件名を設定します。'
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '管理者宛 : 本文',
			hint:       '管理者宛に送信される、メールの上部に表示される文章を設定します。'
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'ユーザ宛 : 件名',
			hint:       'ユーザ宛に送信される、メールの件名を設定します。'
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'ユーザ宛 : 本文',
			hint:       'ユーザ宛に送信される、メールの上部に表示される文章を設定します。'
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '送信完了メッセージ',
			hint:       'メール送信が完了した際に、ページ上に表示されるメッセージを入力します。'
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      '送信完了タグ',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxon01',
			label:      '入力内容 確認画面を表示',
			hint:       'IE9以下のブラウザでは確認機能は利用できません。(入力内容がそのまま送信されるフォームになります)'
		});
	}

	/// カスタムページ ///
	if(blogID == 11){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog,blogtextarea01,blogtextarea02,blogcheckboxoff01,blogtextarea03,blogtextarea04,blogcheckboxoff02' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'blogtextarea01',
			label:      'トップページHTML リスト 上',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea02',
			label:      'トップページHTML リスト 下',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff01',
			label:      'PCトップ 一覧 非表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea03',
			label:      'SP トップページHTML リスト 上',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogtextarea04',
			label:      'SP トップページHTML リスト 下',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff02',
			label:      'スマートフォントップ 一覧 非表示',
			hint:       ''
		});
	}

	/// カテゴリーページ ///
	if(blogID == 19){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog,blogtextarea01,blogtextarea02,blogcheckboxoff01,blogtextarea03,blogtextarea04,blogcheckboxoff02' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea01',
			label:      'トップページHTML リスト 上',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea02',
			label:      'トップページHTML リスト 下',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff01',
			label:      'PCトップ 一覧 非表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea03',
			label:      'スマートフォン トップページHTML リスト 上',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogtextarea04',
			label:      'スマートフォン トップページHTML リスト 下',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff02',
			label:      'スマートフォントップ 一覧 非表示',
			hint:       ''
		});
	}

	/// カテゴリーページ 店舗紹介///
	if(blogID == 80){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog,blogtextarea01,blogtextarea02,blogcheckboxoff01,blogtextarea03,blogtextarea04,blogcheckboxoff02' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea01',
			label:      'トップページHTML リスト 上',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea02',
			label:      'トップページHTML リスト 下',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff01',
			label:      'PCトップ 一覧 非表示',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'blogtextarea03',
			label:      'スマートフォン トップページHTML リスト 上',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogtextarea04',
			label:      'スマートフォン トップページHTML リスト 下',
			hint:       'PCと別の内容を表示したい場合、入力を行います。スマートフォンのみ何も表示したくない場合には、空のコメント<!-- -->を入力してください。'
		});
		$.MTAppCustomize({
			basename:   'blogcheckboxoff02',
			label:      'スマートフォントップ 一覧 非表示',
			hint:       ''
		});
	}

	/// フリーページ ///
	if(blogID == 12){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ 購入をお考えの方へ///
	if(blogID == 74){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ トリミング///
	if(blogID == 75){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ ペットホテル///
	if(blogID == 76){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ ドッグラン///
	if(blogID == 77){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ リクルート///
	if(blogID == 79){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ ドッグカフェ///
	if(blogID == 84){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// フリーページ お問い合わせ一覧 ///
	if(blogID == 90){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// デュプリケートページ ///
	if(blogID == 17){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + '' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// 用語集 ///
	if(blogID == 59){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,wordsrepflag,text01,text02,text03,wordsvisibleflag,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '置換キーワード(記事タイトル以外を指定)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      '置換URL : PC (記事URL以外を指定)',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      '置換URL : 携帯 (記事URL以外を指定)',
			hint:       ''
		});
	}

	/// ギャラリー グッズ販売///
	if(blogID == 60){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,image02,image03,image04,image05,image06,image07,image08,text01,checkboxoff01,checkboxoff02,checkboxoff03,checkboxoff04,checkboxoff05,checkboxoff06,checkboxoff07,checkboxoff08,checkboxoff09,checkboxoff10,checkboxoff11,checkboxoff12,checkboxoff13,checkboxoff14,textarea01,textarea02,textarea03,text02,textarea04,text03,textarea05,text04,textarea06,text05,textarea07,text06,textarea08,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '写真2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '写真3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '写真4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '写真5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '写真6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '写真7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '写真8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '顔の形 : 卵',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '顔の形 : 丸',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '顔の形 : 逆三角',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '顔の形 : ベース',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '顔の形 : 面長',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '髪の量 : 少ない',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '髪の量 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '髪の量 : 多い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff09',
			label:      '髪の質 : 柔らかい',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff10',
			label:      '髪の質 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff11',
			label:      '髪の質 : 硬い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff12',
			label:      '髪のクセ : なし',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff13',
			label:      '髪のクセ : 弱い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff14',
			label:      '髪のクセ : 強い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'スタイリスト',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'メニュー',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '料金',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
	}

	/// ギャラリー 里親募集///
	if(blogID == 78){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,image02,image03,image04,image05,image06,image07,image08,text01,checkboxoff01,checkboxoff02,checkboxoff03,checkboxoff04,checkboxoff05,checkboxoff06,checkboxoff07,checkboxoff08,checkboxoff09,checkboxoff10,checkboxoff11,checkboxoff12,checkboxoff13,checkboxoff14,textarea01,textarea02,textarea03,text02,textarea04,text03,textarea05,text04,textarea06,text05,textarea07,text06,textarea08,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '写真2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '写真3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '写真4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '写真5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '写真6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '写真7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '写真8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '顔の形 : 卵',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '顔の形 : 丸',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '顔の形 : 逆三角',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '顔の形 : ベース',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '顔の形 : 面長',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '髪の量 : 少ない',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '髪の量 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '髪の量 : 多い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff09',
			label:      '髪の質 : 柔らかい',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff10',
			label:      '髪の質 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff11',
			label:      '髪の質 : 硬い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff12',
			label:      '髪のクセ : なし',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff13',
			label:      '髪のクセ : 弱い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff14',
			label:      '髪のクセ : 強い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'スタイリスト',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      'メニュー',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '料金',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
	}


	/// ギャラリー 犬の販売///
	if(blogID == 73){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text07,text,image01,image02,image03,image04,image05,image06,image07,image08,text01,checkboxoff01,checkboxoff02,checkboxoff03,checkboxoff04,checkboxoff05,checkboxoff06,checkboxoff07,checkboxoff08,checkboxoff09,checkboxoff10,checkboxoff11,checkboxoff12,checkboxoff13,checkboxoff14,textarea01,textarea02,textarea03,genderselect,text08,textarea09,text02,textarea04,text03,textarea05,text04,textarea06,text05,textarea07,text06,textarea08,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '写真2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '写真3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '写真4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '写真5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '写真6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '写真7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '写真8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '販売終了',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'genderselect',
			label:      '性別',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '顔の形 : 丸',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '顔の形 : 逆三角',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '顔の形 : ベース',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '顔の形 : 面長',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '髪の量 : 少ない',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '髪の量 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '髪の量 : 多い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff09',
			label:      '髪の質 : 柔らかい',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff10',
			label:      '髪の質 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff11',
			label:      '髪の質 : 硬い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff12',
			label:      '髪のクセ : なし',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff13',
			label:      '髪のクセ : 弱い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff14',
			label:      '髪のクセ : 強い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '種類',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '出身地',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '生年月日',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea09',
			label:      '値段',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text07',
			label:      'タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text08',
			label:      '性別',
			hint:       '男の子・女の子以外の時に入力'
		});
	}

	/// ギャラリー 猫の販売///
	if(blogID == 82){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text07,text,image01,image02,image03,image04,image05,image06,image07,image08,text01,checkboxoff01,checkboxoff02,checkboxoff03,checkboxoff04,checkboxoff05,checkboxoff06,checkboxoff07,checkboxoff08,checkboxoff09,checkboxoff10,checkboxoff11,checkboxoff12,checkboxoff13,checkboxoff14,textarea01,textarea02,textarea03,genderselect,text08,textarea09,text02,textarea04,text03,textarea05,text04,textarea06,text05,textarea07,text06,textarea08,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '写真2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '写真3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '写真4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '写真5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '写真6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '写真7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '写真8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '販売終了',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'genderselect',
			label:      '性別',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '顔の形 : 丸',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '顔の形 : 逆三角',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '顔の形 : ベース',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '顔の形 : 面長',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '髪の量 : 少ない',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '髪の量 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '髪の量 : 多い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff09',
			label:      '髪の質 : 柔らかい',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff10',
			label:      '髪の質 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff11',
			label:      '髪の質 : 硬い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff12',
			label:      '髪のクセ : なし',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff13',
			label:      '髪のクセ : 弱い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff14',
			label:      '髪のクセ : 強い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '種類',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '出身地',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '生年月日',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea09',
			label:      '値段',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text07',
			label:      'タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text08',
			label:      '性別',
			hint:       '男の子・女の子以外の時に入力'
		});
	}

	/// ギャラリー その他の動物の販売///
	if(blogID == 83){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text07,text,image01,image02,image03,image04,image05,image06,image07,image08,text01,checkboxoff01,checkboxoff02,checkboxoff03,checkboxoff04,checkboxoff05,checkboxoff06,checkboxoff07,checkboxoff08,checkboxoff09,checkboxoff10,checkboxoff11,checkboxoff12,checkboxoff13,checkboxoff14,textarea01,textarea02,textarea03,genderselect,text08,textarea09,text02,textarea04,text03,textarea05,text04,textarea06,text05,textarea07,text06,textarea08,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      '写真2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      '写真3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      '写真4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      '写真5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      '写真6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',
			label:      '写真7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',
			label:      '写真8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '販売終了',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'genderselect',
			label:      '性別',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff02',
			label:      '顔の形 : 丸',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff03',
			label:      '顔の形 : 逆三角',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff04',
			label:      '顔の形 : ベース',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff05',
			label:      '顔の形 : 面長',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff06',
			label:      '髪の量 : 少ない',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff07',
			label:      '髪の量 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff08',
			label:      '髪の量 : 多い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff09',
			label:      '髪の質 : 柔らかい',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff10',
			label:      '髪の質 : 普通',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff11',
			label:      '髪の質 : 硬い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff12',
			label:      '髪のクセ : なし',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff13',
			label:      '髪のクセ : 弱い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff14',
			label:      '髪のクセ : 強い',
			showField:  'hide',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '種類',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '出身地',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '生年月日',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea09',
			label:      '値段',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea08',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text07',
			label:      'タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text08',
			label:      '性別',
			hint:       '男の子・女の子以外の時に入力'
		});
	}

	/// スタッフ ///
	if(blogID == 66){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,description,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,text01,textarea01,textarea02,text02,textarea03,text03,textarea04,text04,textarea05,text05,textarea06,text06,textarea07,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '写真',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text01',
			label:      'キャッチコピー',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '名前',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '肩書き',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',
			label:      'フリー1 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      'フリー1 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',
			label:      'フリー2 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      'フリー2 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text04',
			label:      'フリー3 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea05',
			label:      'フリー3 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text05',
			label:      'フリー4 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea06',
			label:      'フリー4 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text06',
			label:      'フリー5 タイトル',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea07',
			label:      'フリー5 本文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'catimage01',
			label:      '画像',
			hint:       ''
		});
	}

	/// ギャラリー lightbox ///
	if(blogID == 53){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,description,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent: 'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'テキスト',
			hint:       ''
		});
	}

	/// フォトギャラリー ///
	if(blogID == 67){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',catimage01,systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
	}

	/// クーポンページ ///
	if(blogID == 62 || blogID == 63){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,textarea01,textarea02,textarea03,date01,checkboxoff01,textarea04'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent: 'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'クーポンメニュー',
			hint:       'クーポンの特典内容を入れてください。'
		});
		$.MTAppCustomize({
			basename:   'textarea02',
			label:      '利用条件',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea03',
			label:      '備考',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'date01',
			label:      '有効期限',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      'ユーザ情報 記入欄表示チェック',
			hint:       'ユーザ情報 記入欄を表示する場合はチェックを入れてください。(PCサイトのみ表示)'
		});
		$.MTAppCustomize({
			basename:   'textarea04',
			label:      '記入欄コメント',
			hint:       'PCサイトのみ表示'
		});
	}

	/// Q&A ///
	if(blogID == 64){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
	}

	/// ピックアップ：お客様の声 ///
	if(blogID == 65){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

	/// ピックアップ：お客様の声 ///
	if(blogID == 65){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

	/// ピックアップ ペッツマックス：お客様の声 ///
	if(blogID == 86){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

	/// ピックアップ わんわんペットセンター：お客様の声 ///
	if(blogID == 87){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

	/// ピックアップ ペットショップケンネル大名店：お客様の声 ///
	if(blogID == 89){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

	/// ピックアップ ペットショップケンネルみやき店：お客様の声 ///
	if(blogID == 91){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,textarea01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      '画像キャプション',
			hint:       ''
		});
	}

		/// ピックアップ ペットショップケンネル佐世保店：お客様の声 ///
		if(blogID == 94){
			//カテゴリ カスタムフィールド 設定
			if(mtappVars.screen_id == 'edit-category'){
				$.MTAppFieldSort({
					sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
					insertID: categoryDefInsetId
				});
			}
			//ブログ カスタムフィールド 設定
			if(mtappVars.screen_id == 'edit-blog'){
				$.MTAppFieldSort({
					sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
					insertID: blogDefInsetId
				});
			}
	
			/// 表示順 ///
			$.MTAppFieldSort({
				sort: 'title,permalink,text,image01,textarea01'
			});
			/// 基本項目 ///
			$.MTAppCustomize({
				basename:   'title',
				label:      '',
				hint:      ''
			});
			$.MTAppCustomize({
				basename:   'body',
				label:      basicBodyName,
				hint:       basicBodyHint,
				showField:  basicBodyShow, //「本文」タブの設定 show or hide,
				showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
			});
			$.MTAppCustomize({
				basename:   'more',
				label:      basicMoreName,
				showField:  basicMoreShow //「追記」タブの設定 show or hide
			});
			/// 追加項目 ///
			$.MTAppCustomize({
				basename:   'image01',
				label:      '画像',
				hint:       ''
			});
			$.MTAppCustomize({
				basename:   'textarea01',
				label:      '画像キャプション',
				hint:       ''
			});
		}

			/// ピックアップ ペットショップケンネル伊万里店：お客様の声 ///
			if(blogID == 93){
				//カテゴリ カスタムフィールド 設定
				if(mtappVars.screen_id == 'edit-category'){
					$.MTAppFieldSort({
						sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
						insertID: categoryDefInsetId
					});
				}
				//ブログ カスタムフィールド 設定
				if(mtappVars.screen_id == 'edit-blog'){
					$.MTAppFieldSort({
						sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
						insertID: blogDefInsetId
					});
				}
		
				/// 表示順 ///
				$.MTAppFieldSort({
					sort: 'title,permalink,text,image01,textarea01'
				});
				/// 基本項目 ///
				$.MTAppCustomize({
					basename:   'title',
					label:      '',
					hint:      ''
				});
				$.MTAppCustomize({
					basename:   'body',
					label:      basicBodyName,
					hint:       basicBodyHint,
					showField:  basicBodyShow, //「本文」タブの設定 show or hide,
					showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
				});
				$.MTAppCustomize({
					basename:   'more',
					label:      basicMoreName,
					showField:  basicMoreShow //「追記」タブの設定 show or hide
				});
				/// 追加項目 ///
				$.MTAppCustomize({
					basename:   'image01',
					label:      '画像',
					hint:       ''
				});
				$.MTAppCustomize({
					basename:   'textarea01',
					label:      '画像キャプション',
					hint:       ''
				});
			}


			/// ピックアップ ペットショップケンネル武夫店：お客様の声 ///
			if(blogID == 95){
				//カテゴリ カスタムフィールド 設定
				if(mtappVars.screen_id == 'edit-category'){
					$.MTAppFieldSort({
						sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
						insertID: categoryDefInsetId
					});
				}
				//ブログ カスタムフィールド 設定
				if(mtappVars.screen_id == 'edit-blog'){
					$.MTAppFieldSort({
						sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
						insertID: blogDefInsetId
					});
				}
		
				/// 表示順 ///
				$.MTAppFieldSort({
					sort: 'title,permalink,text,image01,textarea01'
				});
				/// 基本項目 ///
				$.MTAppCustomize({
					basename:   'title',
					label:      '',
					hint:      ''
				});
				$.MTAppCustomize({
					basename:   'body',
					label:      basicBodyName,
					hint:       basicBodyHint,
					showField:  basicBodyShow, //「本文」タブの設定 show or hide,
					showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
				});
				$.MTAppCustomize({
					basename:   'more',
					label:      basicMoreName,
					showField:  basicMoreShow //「追記」タブの設定 show or hide
				});
				/// 追加項目 ///
				$.MTAppCustomize({
					basename:   'image01',
					label:      '画像',
					hint:       ''
				});
				$.MTAppCustomize({
					basename:   'textarea01',
					label:      '画像キャプション',
					hint:       ''
				});
			}


	/// フリーページ2 ///
	if(blogID == 39){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,image01,image02,image03,image04,image05,image06,checkboxoff01,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      basicBodyName,
			hint:       basicBodyHint,
			showField:  basicBodyShow, //「本文」タブの設定 show or hide,
			showParent: basicBodyAndMoreShow //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      basicMoreName,
			showField:  basicMoreShow //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'image01',
			label:      'メイン画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',
			label:      'サブ画像1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',
			label:      'サブ画像2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',
			label:      'サブ画像3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',
			label:      'サブ画像4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',
			label:      'サブ画像5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'checkboxoff01',
			label:      '画像左右選択',
			hint:       '画像を右側表示にしたい場合はチェックしてください。（初期は左表示です）'
		});
	}

	/// メニューページ ///
	if(blogID == 68){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + '' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,textarea01,image01'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      '',
			hint:      ''
		});
		$.MTAppCustomize({
			basename:   'body',
			label:      '',
			hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent: 'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',
			label:      '値段',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',
			label:      'コメント',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',
			label:      '画像',
			hint:       ''
		});
	}

	/// 事例集 施工前後 ///
	if(blogID == 69){
		//カテゴリ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-category'){
			$.MTAppFieldSort({
				sort: categoryDefSortBefore + ',systitlecat,syskeywordscat,sysdescriptioncat,sysh1cat' + categoryDefSortAfter,
				insertID: categoryDefInsetId
			});
		}
		//ブログ カスタムフィールド 設定
		if(mtappVars.screen_id == 'edit-blog'){
			$.MTAppFieldSort({
				sort: blogDefSortBefore + ',systitleblog,syskeywordsblog,sysdescriptionblog,sysh1blog' + blogDefSortAfter,
				insertID: blogDefInsetId
			});
		}

		/// 表示順 ///
		$.MTAppFieldSort({
			sort: 'title,permalink,text,text01,image01,text02,image02,text03,textarea01,image03,image04,image05,image06,image07,image08,image09,image10,image11,image12,image13,image14,systitle,syskeywords,sysdescription,sysh1'
		});
		/// 基本項目 ///
		$.MTAppCustomize({
			basename:   'title',
			label:      titleLabelNotUse,
			hint:      titleHintNotUse
		});
		$.MTAppCustomize({
			basename:   'body',
			// label:      '',
			// hint:       '',
			showField:  'hide', //「本文」タブの設定 show or hide,
			showParent: 'hide' //「本文+追記」全体の設定 show or hide
		});
		$.MTAppCustomize({
			basename:   'more',
			// label:      '',
			showField:  'hide' //「追記」タブの設定 show or hide
		});
		/// 追加項目 ///
		$.MTAppCustomize({
			basename:   'text01',//w_title
			label:      '物件名称',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image01',//w_before
			label:      '施工前写真',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text02',//w_before_text
			label:      '施工前説明文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image02',//w_after
			label:      '施工後写真 / メイン画像',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'text03',//w_after_text
			label:      '施工後説明文',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'textarea01',//w_contents
			label:      '施工概要',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image03',//w_album1
			label:      'ギャラリー1',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image04',//w_album2
			label:      'ギャラリー2',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image05',//w_album3
			label:      'ギャラリー3',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image06',//w_album4
			label:      'ギャラリー4',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image07',//w_album5
			label:      'ギャラリー5',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image08',//w_album6
			label:      'ギャラリー6',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image09',//w_album7
			label:      'ギャラリー7',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image10',//w_album8
			label:      'ギャラリー8',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image11',//w_album9
			label:      'ギャラリー9',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image12',//w_album10
			label:      'ギャラリー10',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image13',//w_album11
			label:      'ギャラリー11',
			hint:       ''
		});
		$.MTAppCustomize({
			basename:   'image14',//w_album12
			label:      'ギャラリー12',
			hint:       ''
		});
	}

})(jQuery);
