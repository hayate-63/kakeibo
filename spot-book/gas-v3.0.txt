/**
 * スポット帳 v3.0 — Google Apps Script（GAS）
 * v2.0：訪問記録（visits タブ）・思い出ノート・写真（Google Drive）を追加
 * v3.0：ジャンル114種＋自動判定（classifyGenres／reclassifyAll）、座標の自動補完（fillCoords／resolveCoords）
 *
 * 構成：単一HTML（PWA）＋ 本GAS ＋ Googleスプレッドシート（DB）
 * 通信：POST（Content-Type: text/plain;charset=utf-8）で JSON を送る。
 *       { action: "...", pin: "....", ...引数 }
 * 応答：{ status: "ok", ... } または { status: "error", code: "...", message: "..." }
 *
 * デプロイ手順（実装メモ §10 も参照）：
 *   1. 新規プロジェクトにこのファイルを丸ごと貼る
 *   2. 下の SECRET_PIN を本人のパスワード（PIN）に書き換える
 *   3. エディタで関数 setup を1回実行（権限承認 → スプレッドシート作成・初期化）
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行ユーザー：自分 ／ アクセスできるユーザー：全員
 *   5. 発行された URL をアプリの設定タブに入れる
 *
 * v2.0 から v3.0 への更新も同じ手順（a〜c）。setup の実行で tags タブに
 * 判定キーワード・Places種別・グループの列と新しいジャンルが自動で追加される。
 *
 * v1.0 から v2.0 への更新（同じプロジェクト・同じURLのまま）：
 *   a. このファイルで中身を丸ごと置き換え、SECRET_PIN を今のパスワードに戻す
 *   b. エディタで setup を1回実行 → Google Drive の権限を承認
 *      （visits タブと Drive の「スポット帳 写真」フォルダが作られる）
 *   c. デプロイ → デプロイを管理 → 編集（鉛筆）→ バージョン「新バージョン」→ デプロイ
 *      （「新しいデプロイ」にするとURLが変わるので注意）
 */

// ==================== 設定 ====================
// ★本人のパスワード（PIN）に書き換えること。v1.0.1 からパスワード形式（英数字＋記号、4〜64文字、空白不可）。
//   照合は文字列の完全一致。シングルクォート（'）やバックスラッシュ（\）を含む場合は \ でエスケープする
//   例：パスワードが  Ab'c\9!  なら  const SECRET_PIN = 'Ab\'c\\9!';
const SECRET_PIN = '0000';

const SHEET_SPOTS = 'spots';
const SHEET_TAGS = 'tags';
const SHEET_CONFIG = 'config';
const SHEET_VISITS = 'visits';
const PHOTO_FOLDER_NAME = 'スポット帳 写真';
const MAX_PHOTOS = 5;
const TZ = 'Asia/Tokyo';

// visits タブの列（1訪問＝1行。v2.0 設計メモ §2）
const VISIT_HEADERS = [
  'visit_id', 'spot_id', 'date', 'rating', 'menu', 'price', 'companions', 'people',
  'comment', 'photos', 'repeat', 'created_at', 'updated_at'
];

// spots タブの列（spots-import-v10.csv のヘッダーと完全一致）
const SPOT_HEADERS = [
  'id', 'place_id', 'name', 'prefecture', 'city', 'categories', 'tags', 'regions',
  'rep_tag', 'address', 'lat', 'lng', 'maps_url', 'status', 'rating', 'memo',
  'google_saved', 'coord_source', 'source_lists', 'created_at', 'updated_at'
];

// tags タブ（タグマスタ）。代表優先順は「代表タグ自動決定の優先順」（空＝自動決定の対象外）
// v3.0：判定キーワード（店名の判定辞書。「|」区切り）・Places種別（「|」区切り）・グループ（ジャンルタブの見出し）を追加
//   判定キーワードの書き方：
//     語        … 店名に含めば付ける（英字の大小・全角半角は区別しない）
//     語$       … 店名の末尾がその語なら付ける（例：寺$）
//     語@項目   … その項目のスポットで、かつ「!語」を店名に含まない時だけ付ける（弱いキーワード。例：麺@グルメ）
//     -語       … 店名のその部分は判定に使わない（例：中華 の -中華そば）
//     !語       … 店名にその語があれば「語@項目」の弱いキーワードを使わない（例：ラーメン の !うどん）
const TAG_HEADERS = ['タグ名', '絵文字', '並び順', '種別', '代表優先順', '判定キーワード', 'Places種別', 'グループ'];

// tags 初期値（設計メモ §4・§5 の絵文字対応表）。初回の setup 時にだけ書き込む。
// 以後の追加・変更はスプレッドシートの tags タブで行う（コードは参照しない）。
// ジャンル（確定版 genre-master-v30・114種）。[タグ名, 絵文字, 並び順, 種別, 代表優先順, 判定キーワード, Places種別, グループ]
// 既存ジャンル（v1.0 からあるもの）の絵文字は変更していない。Places種別は補助（実在未確認のものを含む。実装メモ参照）
const GENRE_MASTER = [
  ["ラーメン", "🍜", 1, "ジャンル", 2, "ラーメン|らーめん|らぁ麺|拉麺|中華そば|麺@グルメ|!冷麺|!うどん|!そば|!蕎麦|!パスタ|!そうめん|!フォー|!製麺", "ramen_restaurant", "麺"],
  ["つけ麺", "🍜", 2, "ジャンル", 3, "つけ麺|つけめん", "", "麺"],
  ["うどん", "🍥", 3, "ジャンル", 4, "うどん|饂飩|-皿うどん", "udon_noodle_restaurant", "麺"],
  ["そば", "🥢", 4, "ジャンル", 5, "そば|蕎麦|-中華そば|-焼きそば|-焼そば|-まぜそば|-油そば", "soba_noodle_restaurant|soba_restaurant", "麺"],
  ["パスタ", "🍝", 5, "ジャンル", 24, "パスタ|スパゲッティ|スパゲティ|トラットリア|リストランテ|pasta", "italian_restaurant", "麺"],
  ["焼きそば・まぜそば", "🍳", 6, "ジャンル", 33, "焼きそば|焼そば|まぜそば|油そば", "", "麺"],
  ["ちゃんぽん・皿うどん", "🥣", 7, "ジャンル", 34, "ちゃんぽん|皿うどん", "", "麺"],
  ["フォー", "🍜", 8, "ジャンル", 32, "フォー@グルメ|!フォーク|!シーズン", "vietnamese_restaurant", "麺"],
  ["うなぎ", "📌", 9, "ジャンル", 1, "うなぎ|鰻", "unagi_restaurant", "和食"],
  ["寿司", "🍣", 10, "ジャンル", 13, "寿司|鮨|すし|鮓", "sushi_restaurant", "和食"],
  ["海鮮", "🐟", 11, "ジャンル", 14, "海鮮|鮮魚|魚介|海の幸", "seafood_restaurant", "和食"],
  ["天ぷら", "🍤", 12, "ジャンル", 15, "天ぷら|天麩羅|天婦羅", "tempura_restaurant", "和食"],
  ["とんかつ", "🐷", 13, "ジャンル", 16, "とんかつ|トンカツ|串かつ|串カツ|豚カツ", "tonkatsu_restaurant", "和食"],
  ["焼き鳥", "🍗", 14, "ジャンル", 17, "焼き鳥|焼鳥|やきとり", "yakitori_restaurant", "和食"],
  ["たこ焼き", "🐙", 15, "ジャンル", 18, "たこ焼き|たこ焼|たこやき|タコヤキ", "takoyaki_restaurant", "和食"],
  ["お好み焼き", "🥞", 16, "ジャンル", 19, "お好み焼き|お好み焼|もんじゃ", "okonomiyaki_restaurant", "和食"],
  ["すき焼き", "🥓", 17, "ジャンル", 20, "すき焼き|すき焼|すきやき", "sukiyaki_restaurant", "和食"],
  ["鍋・しゃぶしゃぶ", "🍲", 18, "ジャンル", 21, "しゃぶしゃぶ|もつ鍋|ちゃんこ", "shabu_shabu_restaurant|hot_pot_restaurant", "和食"],
  ["定食・食堂", "🍚", 19, "ジャンル", 37, "定食|食堂|ごはん屋", "", "和食"],
  ["居酒屋", "🍻", 20, "ジャンル", 38, "居酒屋|酒場", "izakaya_restaurant|izakaya", "和食"],
  ["懐石・割烹", "🎍", 21, "ジャンル", 36, "懐石|割烹|料亭", "kaiseki_restaurant", "和食"],
  ["おでん", "🍢", 22, "ジャンル", 39, "おでん", "oden_restaurant", "和食"],
  ["焼肉", "🥩", 23, "ジャンル", 7, "焼肉|焼き肉", "yakiniku_restaurant", "肉"],
  ["ステーキ", "🥩", 24, "ジャンル", 11, "ステーキ|鉄板焼", "steak_house", "肉"],
  ["ハンバーグ", "🍖", 25, "ジャンル", 12, "ハンバーグ", "", "肉"],
  ["ホルモン", "🥓", 26, "ジャンル", 8, "ホルモン", "", "肉"],
  ["ジンギスカン", "🐑", 27, "ジャンル", 9, "ジンギスカン", "", "肉"],
  ["馬刺し・ジビエ", "🐴", 28, "ジャンル", 10, "馬刺|馬肉|ジビエ", "", "肉"],
  ["中華", "🥟", 29, "ジャンル", 27, "中華|中国料理|四川|広東|上海|-中華そば", "chinese_restaurant", "各国"],
  ["餃子", "🥟", 30, "ジャンル", 6, "餃子|ぎょうざ|ギョーザ", "gyoza_restaurant", "各国"],
  ["台湾料理", "🇹🇼", 31, "ジャンル", 28, "台湾|-台湾ラーメン|-台湾まぜそば|-台湾ドーナツ|-台湾カステラ", "taiwanese_restaurant", "各国"],
  ["韓国料理", "🇰🇷", 32, "ジャンル", 29, "韓国|キムチ|サムギョプサル|冷麺", "korean_restaurant", "各国"],
  ["タイ料理", "🇹🇭", 33, "ジャンル", 30, "タイ料理|タイ国", "thai_restaurant", "各国"],
  ["インドカレー", "🫓", 34, "ジャンル", 23, "インド|ネパール", "indian_restaurant", "各国"],
  ["ベトナム料理", "🇻🇳", 35, "ジャンル", 31, "ベトナム", "vietnamese_restaurant", "各国"],
  ["フレンチ", "🇫🇷", 36, "ジャンル", 35, "フレンチ|フランス料理|ビストロ", "french_restaurant", "各国"],
  ["ピザ", "🍕", 37, "ジャンル", 25, "ピザ|ピッツァ|ピッツェリア|pizza|pizzeria", "pizza_restaurant", "各国"],
  ["ハンバーガー", "🍔", 38, "ジャンル", 26, "バーガー|burger", "hamburger_restaurant", "各国"],
  ["カレー", "🍛", 39, "ジャンル", 22, "カレー|カリー|curry", "curry_restaurant|japanese_curry_restaurant", "各国"],
  ["ビュッフェ", "🍽️", 40, "ジャンル", 40, "ビュッフェ|バイキング|食べ放題", "buffet_restaurant", "各国"],
  ["喫茶店", "☕", 41, "ジャンル", 45, "喫茶", "", "カフェ・甘味"],
  ["パン・ベーカリー", "🥐", 42, "ジャンル", 51, "パン屋|ベーカリー|ブーランジェリー|ベッカライ|bakery|boulangerie", "bakery", "カフェ・甘味"],
  ["スイーツ・ケーキ", "🍰", 43, "ジャンル", 46, "ケーキ|パティスリー|スイーツ|洋菓子", "cake_shop|dessert_shop", "カフェ・甘味"],
  ["かき氷", "🍧", 44, "ジャンル", 48, "かき氷|かきごおり", "", "カフェ・甘味"],
  ["和菓子", "🍡", 45, "ジャンル", 47, "和菓子|菓子舗|まんじゅう|饅頭|-洋菓子", "japanese_confectionery_shop|japanese_sweets_shop", "カフェ・甘味"],
  ["ドーナツ", "🍩", 46, "ジャンル", 49, "ドーナツ|donut|doughnut", "donut_shop", "カフェ・甘味"],
  ["ジェラート・アイス", "🍨", 47, "ジャンル", 50, "ジェラート|アイスクリーム|ソフトクリーム", "ice_cream_shop", "カフェ・甘味"],
  ["タピオカ", "🧋", 48, "ジャンル", 52, "タピオカ", "bubble_tea_store", "カフェ・甘味"],
  ["バー", "🍸", 49, "ジャンル", 41, "バー|bar|-バーガー|-burger|-バーベキュー|-サーバー|-カバー|-バーバー|-barber|-barn", "bar|cocktail_bar", "酒"],
  ["日本酒", "🍶", 50, "ジャンル", 42, "日本酒", "sake_bar", "酒"],
  ["クラフトビール", "🍺", 51, "ジャンル", 43, "クラフトビール|ブルワリー|地ビール|craftbeer|craft beer|brewery", "brewery|brewpub", "酒"],
  ["ワイン", "🍷", 52, "ジャンル", 44, "ワイン", "wine_bar", "酒"],
  ["温泉", "♨️", 53, "ジャンル", 53, "温泉", "hot_spring|onsen", "癒し"],
  ["日帰り温泉", "♨️", 54, "ジャンル", 54, "日帰り温泉|日帰り湯", "", "癒し"],
  ["サウナ", "🧖", 55, "ジャンル", 55, "サウナ|スパ銭|健康ランド", "sauna", "癒し"],
  ["岩盤浴", "🪨", 56, "ジャンル", 56, "岩盤浴", "", "癒し"],
  ["銭湯", "🛁", 57, "ジャンル", 57, "銭湯", "public_bath", "癒し"],
  ["マッサージ・整体", "💆", 58, "ジャンル", 58, "マッサージ|整体|リラク", "massage|massage_spa", "癒し"],
  ["美容", "💉", 59, "ジャンル", 59, "美容室|美容院|ヘアサロン|理容|美容外科|美容皮膚科|美容クリニック|美容医療", "hair_salon|beauty_salon", "癒し"],
  ["神社", "⛩️", 60, "ジャンル", 69, "神社|神宮|大社|稲荷", "shinto_shrine", "観光"],
  ["寺", "🛕", 61, "ジャンル", 70, "寺$|寺院|大寺|観音", "buddhist_temple", "観光"],
  ["城", "🏯", 62, "ジャンル", 68, "城$|城跡|城址", "castle", "観光"],
  ["博物館・美術館", "🏛️", 63, "ジャンル", 71, "博物館|美術館|科学館|記念館|資料館", "museum|art_museum|art_gallery", "観光"],
  ["水族館", "🐠", 64, "ジャンル", 72, "水族館", "aquarium", "観光"],
  ["動物園", "🦁", 65, "ジャンル", 73, "動物園|サファリ", "zoo", "観光"],
  ["遊園地", "🎡", 66, "ジャンル", 74, "遊園地|テーマパーク", "amusement_park|theme_park", "観光"],
  ["公園", "🌳", 67, "ジャンル", 75, "公園|-公園前|-公園通", "park|national_park|state_park", "観光"],
  ["展望台・タワー", "🗼", 68, "ジャンル", 76, "展望台|展望塔|タワー@観光地", "observation_deck", "観光"],
  ["夜景", "🌃", 69, "ジャンル", 77, "夜景", "", "観光"],
  ["市場", "🦐", 70, "ジャンル", 83, "市場|朝市", "market", "観光"],
  ["道の駅", "🚗", 71, "ジャンル", 84, "道の駅", "rest_stop", "観光"],
  ["滝", "💧", 72, "ジャンル", 78, "の滝|滝$", "waterfall", "観光"],
  ["湖・海・ビーチ", "🏖️", 73, "ジャンル", 79, "ビーチ|海水浴場|海岸|湖畔", "beach", "観光"],
  ["桜・紅葉", "🌸", 74, "ジャンル", 80, "桜@観光地|紅葉@観光地", "", "観光"],
  ["花畑", "🌻", 75, "ジャンル", 81, "花畑|フラワーパーク|花の丘", "", "観光"],
  ["工場見学", "🏭", 76, "ジャンル", 85, "工場見学", "", "観光"],
  ["酒蔵・ワイナリー", "🍇", 77, "ジャンル", 86, "酒蔵|ワイナリー|酒造|蒸溜所|蒸留所", "winery", "観光"],
  ["牧場", "🐄", 78, "ジャンル", 87, "牧場|ファーム", "farm|ranch", "観光"],
  ["イルミネーション", "✨", 79, "ジャンル", 82, "イルミネーション", "", "観光"],
  ["景色", "🌇", 80, "ジャンル", 88, "展望|絶景", "scenic_spot|scenic_point", "観光"],
  ["車 写真撮影場所", "📸", 81, "ジャンル", 90, "", "", "観光"],
  ["キャンプ場", "🏕️", 82, "ジャンル", 60, "キャンプ場|オートキャンプ|キャンプ", "campground|camping_cabin|rv_park", "アウトドア"],
  ["スキー場", "🏂", 83, "ジャンル", 62, "スキー場|ゲレンデ|スノーパーク|スキーリゾート", "ski_resort", "アウトドア"],
  ["釣り", "🎣", 84, "ジャンル", 64, "釣り|フィッシング|釣堀", "fishing_pond|fishing_charter", "アウトドア"],
  ["ハイキング・登山", "⛰️", 85, "ジャンル", 65, "登山|ハイキング|トレッキング", "hiking_area", "アウトドア"],
  ["サイクリング", "🚴", 86, "ジャンル", 67, "サイクリング", "", "アウトドア"],
  ["サーフィン", "🏄", 87, "ジャンル", 66, "サーフ", "surf_shop", "アウトドア"],
  ["ゴルフ場", "⛳", 88, "ジャンル", 63, "ゴルフ", "golf_course", "アウトドア"],
  ["ドライブ・SA/PA", "🛣️", 89, "ジャンル", 100, "サービスエリア|パーキングエリア|ハイウェイオアシス", "rest_stop", "アウトドア"],
  ["旅館", "🏮", 90, "ジャンル", 91, "旅館", "japanese_inn|ryokan", "宿"],
  ["リゾートホテル", "🏨", 91, "ジャンル", 92, "リゾートホテル|リゾート&|リゾート＆", "resort_hotel", "宿"],
  ["民宿・ゲストハウス", "🏡", 92, "ジャンル", 93, "民宿|ゲストハウス|ペンション", "guest_house|bed_and_breakfast", "宿"],
  ["グランピング", "⛺", 93, "ジャンル", 61, "グランピング|glamping", "", "宿"],
  ["車中泊", "🚐", 94, "ジャンル", 94, "車中泊|RVパーク", "rv_park", "宿"],
  ["アウトレット", "🛍️", 95, "ジャンル", 95, "アウトレット", "outlet_mall", "買い物"],
  ["古着", "👕", 96, "ジャンル", 96, "古着|ヴィンテージ|ビンテージ", "vintage_clothing_store", "買い物"],
  ["雑貨", "🧸", 97, "ジャンル", 97, "雑貨", "gift_shop", "買い物"],
  ["書店", "📚", 98, "ジャンル", 98, "書店|本屋|ブックストア", "book_store", "買い物"],
  ["アウトドアショップ", "🎒", 99, "ジャンル", 99, "アウトドア", "sporting_goods_store", "買い物"],
  ["ガソスタ", "⛽", 100, "ジャンル", 101, "ガソリン|SS$|給油|ENEOS|エネオス|出光|コスモ石油|apollostation", "gas_station", "実用"],
  ["駐車場", "🅿️", 101, "ジャンル", 104, "駐車場|パーキング|parking|-パーキングエリア", "parking|parking_lot|parking_garage", "実用"],
  ["病院", "🏥", 102, "ジャンル", 109, "病院|クリニック|医院|-美容外科クリニック|-美容皮膚科クリニック|-美容クリニック", "hospital|doctor", "実用"],
  ["コインランドリー", "🧺", 103, "ジャンル", 105, "コインランドリー", "laundry|laundromat", "実用"],
  ["ドラッグストア", "💊", 104, "ジャンル", 106, "ドラッグ|薬局", "drugstore|pharmacy", "実用"],
  ["スーパー", "🛒", 105, "ジャンル", 107, "スーパー|マーケット|-スーパー銭湯|-フリーマーケット", "supermarket|grocery_store", "実用"],
  ["ホームセンター", "🔨", 106, "ジャンル", 108, "ホームセンター", "home_improvement_store", "実用"],
  ["洗車", "🚿", 107, "ジャンル", 103, "洗車|カーケア", "car_wash", "実用"],
  ["EV充電", "🔌", 108, "ジャンル", 102, "EV充電|充電ステーション", "electric_vehicle_charging_station", "実用"],
  ["デート", "💑", 109, "ジャンル", 110, "", "", "属性"],
  ["子連れOK", "👶", 110, "ジャンル", 111, "", "", "属性"],
  ["ペットOK", "🐶", 111, "ジャンル", 112, "", "", "属性"],
  ["フォトスポット", "📸", 112, "ジャンル", 89, "", "", "属性"],
  ["思い出の場所", "💭", 113, "ジャンル", 113, "", "", "属性"],
  ["Friend", "🏠", 114, "ジャンル", 114, "", "", "属性"]
];

// tags 初期値（新規DB用）。v2.0 以前のDBは migrateTagsV3_ で列とジャンルを追加する
const INITIAL_TAGS = GENRE_MASTER.concat([
  ['定期', '💳', 200, 'ジャンル', '', '', '', 'その他'],
  ['コーティング周辺', '🚗', 201, 'ジャンル', '', '', '', 'その他'],
  ['カフェ', '☕', 1, '項目', '', '', '', ''],
  ['宿', '🏨', 2, '項目', '', '', '', ''],
  ['グルメ', '🍽️', 3, '項目', '', '', '', ''],
  ['観光地', '🌇', 4, '項目', '', '', '', ''],
  ['服', '👕', 5, '項目', '', '', '', ''],
  ['その他', '📍', 6, '項目', '', '', '', ''],
  ['淡路島', '', 1, '地域', '', '', '', ''],
  ['飛騨高山', '', 2, '地域', '', '', '', ''],
  ['上高地', '', 3, '地域', '', '', '', ''],
  ['函館', '', 4, '地域', '', '', '', ''],
  ['札幌', '', 5, '地域', '', '', '', ''],
  ['小樽', '', 6, '地域', '', '', '', ''],
  ['登別', '', 7, '地域', '', '', '', '']
]);

// config 初期値（家計簿と同じ key / value 形式）
const INITIAL_CONFIG = [
  ['places_api_key', ''],
  ['tile_std_url', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'],
  ['tile_std_attr', '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'],
  ['tile_sat_url', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  ['tile_sat_attr', 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'],
  ['queue_checks', '{}']
];

// config のうち getAll でアプリへ返さないキー（APIキーは設定済みかどうかだけ返す）
const SECRET_CONFIG_KEYS = ['places_api_key'];

// ==================== 入口 ====================
function doGet(e) {
  // データは返さない（PIN照合のため POST のみ受け付ける）
  // v2.0.1：接続トラブルの診断用。PIN の値は返さず「初期値 0000 のままか」だけ返す
  return out_({ status: 'ok', version: '3.0', pin_default: String(SECRET_PIN) === '0000',
    message: 'スポット帳 GAS v3.0 稼働中。データ取得は POST で行います。' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ status: 'error', code: 'BAD_REQUEST', message: 'JSON を解釈できません' });
  }
  if (String(req.pin || '') !== String(SECRET_PIN)) {
    return out_({ status: 'error', code: 'AUTH', message: 'PINが一致しません（アプリのパスワードと GAS の SECRET_PIN が違います。GAS を書き換えた場合は「新バージョン」でデプロイし直してください）' });
  }
  try {
    const ss = getSpreadsheet_();
    ensureSheets_(ss);
    switch (req.action) {
      case 'ping': return out_({ status: 'ok' });
      case 'getAll': return out_(getAll_(ss));
      case 'addSpot': return out_(withLock_(() => addSpot_(ss, req.spot || {}, !!req.classified)));
      case 'updateSpot': return out_(withLock_(() => updateSpot_(ss, req.spot || {})));
      case 'deleteSpot': return out_(withLock_(() => deleteSpot_(ss, req.id)));
      case 'importSpots': return out_(withLock_(() => importSpots_(ss, req.rows || [], !!req.dedupeWithinBatch)));
      case 'searchPlace': return out_(searchPlace_(ss, req));
      case 'resolveUrl': return out_(resolveUrl_(ss, req));
      case 'setConfig': return out_(withLock_(() => setConfig_(ss, req.key, req.value)));
      case 'addVisit': return out_(withLock_(() => addVisit_(ss, req.visit || {})));
      case 'updateVisit': return out_(withLock_(() => updateVisit_(ss, req.visit || {})));
      case 'deleteVisit': return out_(withLock_(() => deleteVisit_(ss, req.visit_id, req.deletePhotos !== false)));
      case 'uploadPhoto': return out_(uploadPhoto_(req));
      case 'deletePhoto': return out_(deletePhoto_(req.fileId));
      case 'classifyGenres': return out_({ status: 'ok', tags: classifyGenres_(readTags_(ss), req.name, req.types, req.categories) });
      case 'reclassifyAll': return out_(withLock_(() => reclassifyAll_(ss)));
      case 'fillCoords': return out_(withLock_(() => fillCoords_(ss, req)));
      case 'resolveCoords': return out_(resolveCoordsAction_(ss, req.spot || {}));
      default: return out_({ status: 'error', code: 'UNKNOWN_ACTION', message: '不明な action: ' + req.action });
    }
  } catch (err) {
    return out_({ status: 'error', code: 'SERVER', message: String(err && err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ==================== スプレッドシート準備 ====================
/** エディタから1回実行する初期化。スプレッドシートを用意して URL をログに出す */
function setup() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  const folder = getPhotoFolder_(); // Drive の権限承認もここで行われる
  Logger.log('スポット帳DB: ' + ss.getUrl());
  Logger.log('写真フォルダ: ' + folder.getUrl());
  return ss.getUrl();
}

function getSpreadsheet_() {
  // コンテナバインド（スプレッドシートから開いたスクリプト）ならそれを使う
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) { /* standalone */ }
  // 単体プロジェクトの場合は ID をスクリプトプロパティに保存して使い回す
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('スポット帳DB');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function ensureSheets_(ss) {
  let spots = ss.getSheetByName(SHEET_SPOTS);
  if (!spots) {
    spots = ss.insertSheet(SHEET_SPOTS);
    // 日付や数字の自動変換・数式化を防ぐため全体を書式なしテキストにする
    spots.getRange(1, 1, spots.getMaxRows(), SPOT_HEADERS.length).setNumberFormat('@');
    spots.getRange(1, 1, 1, SPOT_HEADERS.length).setValues([SPOT_HEADERS]).setFontWeight('bold');
    spots.setFrozenRows(1);
  }
  let tags = ss.getSheetByName(SHEET_TAGS);
  if (!tags) {
    tags = ss.insertSheet(SHEET_TAGS);
    tags.getRange(1, 1, 1, TAG_HEADERS.length).setValues([TAG_HEADERS]).setFontWeight('bold');
    tags.getRange(2, 1, INITIAL_TAGS.length, TAG_HEADERS.length).setValues(INITIAL_TAGS);
    tags.setFrozenRows(1);
  } else {
    migrateTagsV3_(tags);
  }
  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) {
    config = ss.insertSheet(SHEET_CONFIG);
    config.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold');
    config.getRange(2, 1, INITIAL_CONFIG.length, 2).setNumberFormat('@').setValues(INITIAL_CONFIG);
    config.setFrozenRows(1);
  }
  // v2.0：visits タブ（v1.0 のDBには無いので、初回アクセス時に自動で作る）
  let visits = ss.getSheetByName(SHEET_VISITS);
  if (!visits) {
    visits = ss.insertSheet(SHEET_VISITS);
    visits.getRange(1, 1, visits.getMaxRows(), VISIT_HEADERS.length).setNumberFormat('@');
    visits.getRange(1, 1, 1, VISIT_HEADERS.length).setValues([VISIT_HEADERS]).setFontWeight('bold');
    visits.setFrozenRows(1);
  }
  // 新規作成時の空シート「シート1」を片付ける（他にデータが無い場合のみ）
  const first = ss.getSheets()[0];
  if (first && [SHEET_SPOTS, SHEET_TAGS, SHEET_CONFIG, SHEET_VISITS].indexOf(first.getName()) < 0 &&
      first.getLastRow() === 0 && ss.getSheets().length > 4) {
    ss.deleteSheet(first);
  }
}

// ==================== 共通 ====================
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function cellToString_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}

function readSpots_(ss) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, SPOT_HEADERS.length).getValues();
  const list = [];
  values.forEach(row => {
    if (!row[0]) return;
    const o = {};
    SPOT_HEADERS.forEach((h, i) => { o[h] = cellToString_(row[i]); });
    list.push(o);
  });
  return list;
}

function readColumn_(sh, colIndex1) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, colIndex1, last - 1, 1).getValues().map(r => cellToString_(r[0]));
}

function readConfigMap_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => {
    if (r[0] !== '') map[String(r[0])] = cellToString_(r[1]);
  });
  return map;
}

function readTags_(ss) {
  const sh = ss.getSheetByName(SHEET_TAGS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = TAG_HEADERS.length;
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({
      name: String(r[0]).trim(),
      emoji: cellToString_(r[1]),
      order: Number(r[2]) || 0,
      type: cellToString_(r[3]) || 'ジャンル',
      repPriority: r[4] === '' || r[4] === undefined ? '' : Number(r[4]),
      keywords: cellToString_(r[5]),
      placeTypes: cellToString_(r[6]),
      group: cellToString_(r[7])
    }));
}

/** スポットオブジェクト → 行配列（空欄補完・文字列化） */
function spotToRow_(s) {
  return SPOT_HEADERS.map(h => {
    const v = s[h];
    return v === null || v === undefined ? '' : String(v);
  });
}

function normalizeSpot_(s) {
  const o = {};
  SPOT_HEADERS.forEach(h => { o[h] = s[h] === null || s[h] === undefined ? '' : String(s[h]).trim(); });
  return o;
}

/** Googleマップ URL から重複判定用のキーを取り出す（0x...:0x... の地物ID か URL そのもの） */
function mapsUrlKey_(url) {
  url = String(url || '').trim();
  if (!url) return '';
  const m = url.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (m) return 'ftid:' + m[1].toLowerCase();
  const cid = url.match(/[?&]cid=(\d+)/);
  if (cid) return 'cid:' + cid[1];
  return 'url:' + url;
}

function nextIdNumber_(ids) {
  let max = 0;
  ids.forEach(id => {
    const m = String(id).match(/^SP(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

function formatId_(n) {
  return 'SP' + String(n).padStart(4, '0');
}

function findRowById_(sh, id) {
  const ids = readColumn_(sh, 1);
  const idx = ids.indexOf(String(id));
  return idx < 0 ? -1 : idx + 2;
}

// ==================== アクション ====================
function getAll_(ss) {
  const config = readConfigMap_(ss);
  const publicConfig = {};
  Object.keys(config).forEach(k => {
    if (SECRET_CONFIG_KEYS.indexOf(k) < 0) publicConfig[k] = config[k];
  });
  publicConfig.places_api_key_set = config.places_api_key ? '1' : '';
  return {
    status: 'ok',
    spots: readSpots_(ss),
    visits: readVisits_(ss),
    tags: readTags_(ss),
    config: publicConfig,
    serverDate: today_()
  };
}

function addSpot_(ss, spot, classified) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const s = normalizeSpot_(spot);
  if (!s.name) return { status: 'error', code: 'VALIDATION', message: '店名が空です' };
  // v3.0：確認カードで判定済み（classified）でなければ、ここで自動判定して本人のタグと合体する
  if (!classified) {
    const master = readTags_(ss);
    const before = splitTags_(s.tags);
    const merged = mergeTags_(before, classifyGenres_(master, s.name, [], s.categories));
    if (!s.rep_tag || s.rep_tag === repFromTags_(before, master)) s.rep_tag = repFromTags_(merged, master);
    s.tags = merged.join('/');
  }
  if (s.place_id) {
    const pids = readColumn_(sh, SPOT_HEADERS.indexOf('place_id') + 1);
    const hit = pids.indexOf(s.place_id);
    if (hit >= 0) {
      const existingId = readColumn_(sh, 1)[hit];
      return { status: 'error', code: 'DUPLICATE', existingId: existingId, message: 'この場所は登録済みです（' + existingId + '）' };
    }
  }
  const ids = readColumn_(sh, 1);
  s.id = formatId_(nextIdNumber_(ids));
  const d = today_();
  s.created_at = d; // 登録日は GAS 側の当日（端末の時計に依存しない）
  s.updated_at = d;
  s.status = '行きたい'; // v2.0：状態は訪問ログから決まる（新規は訪問0件）
  if (!s.google_saved) s.google_saved = '未';
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(s)]);
  return { status: 'ok', spot: s };
}

function updateSpot_(ss, spot) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const s = normalizeSpot_(spot);
  const row = findRowById_(sh, s.id);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象のスポットがありません: ' + s.id };
  if (s.place_id) {
    const pids = readColumn_(sh, SPOT_HEADERS.indexOf('place_id') + 1);
    const ids = readColumn_(sh, 1);
    for (let i = 0; i < pids.length; i++) {
      if (pids[i] === s.place_id && ids[i] !== s.id) {
        return { status: 'error', code: 'DUPLICATE', existingId: ids[i], message: 'この place_id は別のスポット（' + ids[i] + '）で登録済みです' };
      }
    }
  }
  const current = sh.getRange(row, 1, 1, SPOT_HEADERS.length).getValues()[0];
  s.created_at = cellToString_(current[SPOT_HEADERS.indexOf('created_at')]) || s.created_at;
  s.status = statusFromVisits_(ss, s.id); // v2.0：状態は訪問ログから決まる（手で変えさせない）
  s.updated_at = today_();
  sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(s)]);
  return { status: 'ok', spot: s };
}

function deleteSpot_(ss, id) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const row = findRowById_(sh, id);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象のスポットがありません: ' + id };
  // v2.0：思い出（訪問記録）を巻き添えで消さないよう、訪問記録があるスポットは削除させない
  const n = readVisits_(ss).filter(v => v.spot_id === String(id)).length;
  if (n > 0) return { status: 'error', code: 'HAS_VISITS', count: n, message: 'このスポットには訪問記録が ' + n + ' 件あります。先に訪問記録を削除してください' };
  sh.deleteRow(row);
  return { status: 'ok', id: String(id) };
}

// ==================== v3.0 ジャンル（tags の移行・自動判定・一括再判定） ====================
/** v2.0 以前の tags タブに、列（判定キーワード・Places種別・グループ）と新ジャンルを足す。1回だけ動く */
function migrateTagsV3_(sh) {
  const width = Math.max(sh.getLastColumn(), 5);
  const head = sh.getRange(1, 1, 1, width).getValues()[0];
  if (cellToString_(head[5]) === TAG_HEADERS[5]) return false; // 移行済み
  const last = sh.getLastRow();
  const cur = last >= 2 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];
  const byName = {};
  const out = cur.filter(r => String(r[0]).trim() !== '').map(r => {
    const row = [String(r[0]).trim(), cellToString_(r[1]), r[2], cellToString_(r[3]) || 'ジャンル', r[4], '', '', ''];
    byName[row[0]] = row;
    return row;
  });
  GENRE_MASTER.forEach(g => {
    const row = byName[g[0]];
    if (row) {
      // 既存ジャンル：絵文字・種別はそのまま。並び順・代表優先順・判定辞書・グループを確定版にする
      row[2] = g[2]; row[4] = g[4]; row[5] = g[5]; row[6] = g[6]; row[7] = g[7];
    } else {
      out.push(g.slice());
    }
  });
  out.forEach(r => { if (r[3] === 'ジャンル' && !r[7]) r[7] = 'その他'; });
  sh.getRange(1, 1, 1, TAG_HEADERS.length).setValues([TAG_HEADERS]).setFontWeight('bold');
  if (out.length) sh.getRange(2, 1, out.length, TAG_HEADERS.length).setValues(out);
  return true;
}

function splitTags_(s) { return String(s || '').split('/').map(x => x.trim()).filter(String); }
function mergeTags_(a, b) { const o = a.slice(); b.forEach(x => { if (o.indexOf(x) < 0) o.push(x); }); return o; }
function normText_(s) { return String(s || '').normalize('NFKC').toLowerCase(); }

/** 代表タグの自動決定（代表優先順が小さいものが優先。空欄のタグは対象外） */
function repFromTags_(tags, master) {
  let best = '', bp = Infinity;
  master.forEach(t => {
    if (t.repPriority === '' || t.repPriority === null || tags.indexOf(t.name) < 0) return;
    if (Number(t.repPriority) < bp) { bp = Number(t.repPriority); best = t.name; }
  });
  return best;
}

/** 判定キーワード欄を解釈する（strong／suffix／weak@項目／-マスク／!拒否） */
function parseRules_(text) {
  const r = { strong: [], suffix: [], weak: [], mask: [], veto: [] };
  String(text || '').split('|').map(x => x.trim()).filter(String).forEach(k => {
    if (k[0] === '-' && k.length > 1) r.mask.push(normText_(k.slice(1)));
    else if (k[0] === '!' && k.length > 1) r.veto.push(normText_(k.slice(1)));
    else if (k.indexOf('@') > 0) { const i = k.lastIndexOf('@'); r.weak.push({ kw: normText_(k.slice(0, i)), cat: k.slice(i + 1).trim() }); }
    else if (k.length > 1 && k[k.length - 1] === '$') r.suffix.push(normText_(k.slice(0, -1)));
    else r.strong.push(normText_(k));
  });
  return r;
}

/**
 * classifyGenres：店名・Places種別・項目から、付けるべきジャンルタグの配列を返す（追加方向のみ）。
 * 辞書は tags タブの「判定キーワード」「Places種別」列。属性系（デート等）は辞書が空なので付かない。
 * 駐車場と判定された場所は、店名に含まれる他ジャンル（例：〇〇アイスクリーム専用駐車場）を付けない。
 */
function classifyGenres_(master, name, types, categories) {
  const nm = normText_(name).trim();
  const cats = Array.isArray(categories) ? categories : splitTags_(categories);
  const ty = (Array.isArray(types) ? types : splitTags_(types)).map(String);
  const out = [];
  // 店名が住所そのもの（〒〜）の場合は、地名の誤判定を避けるため店名キーワードでは判定しない
  const nameUsable = nm && nm[0] !== '〒';
  master.forEach(t => {
    if (t.type !== 'ジャンル' || (!t.keywords && !t.placeTypes)) return;
    let hit = false;
    if (t.placeTypes && ty.length) {
      hit = t.placeTypes.split('|').map(x => x.trim()).filter(String).some(x => ty.indexOf(x) >= 0);
    }
    if (!hit && t.keywords && nameUsable) {
      const r = parseRules_(t.keywords);
      let masked = nm;
      r.mask.forEach(m => { if (m) masked = masked.split(m).join('\u0000'); });
      hit = r.strong.some(k => k && masked.indexOf(k) >= 0) ||
        r.suffix.some(k => k && masked.slice(-k.length) === k) ||
        (r.weak.some(w => w.kw && cats.indexOf(w.cat) >= 0 && masked.indexOf(w.kw) >= 0) && !r.veto.some(v => v && nm.indexOf(v) >= 0));
    }
    if (hit) out.push(t.name);
  });
  if (out.indexOf('駐車場') >= 0) {
    const practical = {};
    master.forEach(t => { if (t.group === '実用') practical[t.name] = true; });
    return out.filter(n => practical[n]);
  }
  return out;
}

/**
 * reclassifyAll：全スポットを店名＋項目で判定し、足りないタグだけ追加する（削除はしない）。
 * 代表タグは「自動で決まっていたもの（空 or 旧タグからの自動値）」だけ付け直す。手で選んだ代表タグは残す。
 * 書き込みは tags／rep_tag／updated_at の3列をまとめて1回ずつ（変わった行の値だけが変わる）。
 */
function reclassifyAll_(ss) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const master = readTags_(ss);
  const last = sh.getLastRow();
  if (last < 2) return { status: 'ok', spots: 0, added: 0, total: 0, details: [] };
  const n = last - 1;
  const ci = h => SPOT_HEADERS.indexOf(h);
  const vals = sh.getRange(2, 1, n, SPOT_HEADERS.length).getValues();
  const tagCol = [], repCol = [], updCol = [];
  const details = [];
  let spots = 0, added = 0;
  const d = today_();
  vals.forEach(row => {
    const name = cellToString_(row[ci('name')]);
    const before = splitTags_(cellToString_(row[ci('tags')]));
    let rep = cellToString_(row[ci('rep_tag')]);
    let upd = cellToString_(row[ci('updated_at')]);
    let tags = cellToString_(row[ci('tags')]);
    if (row[0]) {
      const add = classifyGenres_(master, name, [], cellToString_(row[ci('categories')])).filter(x => before.indexOf(x) < 0);
      if (add.length) {
        const merged = before.concat(add);
        if (!rep || rep === repFromTags_(before, master)) rep = repFromTags_(merged, master);
        tags = merged.join('/');
        upd = d;
        spots++; added += add.length;
        if (details.length < 300) details.push({ id: cellToString_(row[0]), name: name, added: add });
      }
    }
    tagCol.push([tags]); repCol.push([rep]); updCol.push([upd]);
  });
  if (spots) {
    sh.getRange(2, ci('tags') + 1, n, 1).setNumberFormat('@').setValues(tagCol);
    sh.getRange(2, ci('rep_tag') + 1, n, 1).setNumberFormat('@').setValues(repCol);
    sh.getRange(2, ci('updated_at') + 1, n, 1).setNumberFormat('@').setValues(updCol);
  }
  return { status: 'ok', spots: spots, added: added, total: n, details: details };
}

// ==================== v3.0 座標の自動補完 ====================
function hasCoord_(s) {
  return s.lat !== '' && s.lng !== '' && !isNaN(Number(s.lat)) && !isNaN(Number(s.lng));
}

/**
 * 1件分の座標を探す。順番：マップURLの座標（無料）→ place_id の Places 詳細 →
 * 住所の Nominatim（無料）→ 店名の Places 検索。見つからなければ null。
 */
function resolveCoords_(spot, key, usedNominatim) {
  const s = spot;
  // 1) マップURL（短縮URLは展開）
  if (s.maps_url) {
    let url = s.maps_url;
    if (/goo\.gl|g\.co\//.test(url)) url = expandUrl_(url);
    const info = parseMapsUrl_(url);
    if (info.lat !== '' && info.lng !== '') return { lat: info.lat, lng: info.lng, coord_source: 'URL' };
  }
  // 2) place_id → Places 詳細
  if (key && s.place_id) {
    try { const p = placeDetails_(key, s.place_id); if (p.lat !== '') return { lat: p.lat, lng: p.lng, coord_source: 'Places', address: p.address, prefecture: p.prefecture, city: p.city }; } catch (e) { /* 次へ */ }
  }
  // 3) 住所 → Nominatim（利用規約に従い1秒あける）
  const addr = String(s.address || '').replace(/^日本、?\s*/, '').replace(/〒?\d{3}-?\d{4}\s*/, '').trim();
  if (addr) {
    if (usedNominatim && usedNominatim.n > 0) Utilities.sleep(1100);
    if (usedNominatim) usedNominatim.n++;
    const g = forwardGeocode_(addr);
    if (g) return { lat: g.lat, lng: g.lng, coord_source: 'Nominatim' };
  }
  // 4) 店名 → Places 検索（都道府県・市区町村を添えて誤マッチを減らす）
  if (key && s.name) {
    try {
      const q = [s.name, s.prefecture, s.city].filter(String).join(' ');
      const body = placesFetch_(PLACES_BASE + 'places:searchText', key, 'places.id,places.displayName,places.formattedAddress,places.location',
        { textQuery: q, languageCode: 'ja', regionCode: 'JP', pageSize: 1 });
      const p = (body.places || [])[0];
      if (p && p.location) return { lat: p.location.latitude, lng: p.location.longitude, coord_source: 'Places', address: p.formattedAddress || '' };
    } catch (e) { /* 見つからない */ }
  }
  return null;
}

function forwardGeocode_(q) {
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'SpotBook-GAS/1.0 (personal use)' } });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText() || '[]');
    if (!j.length) return null;
    return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
  } catch (e) { return null; }
}

/** resolveCoords：登録前の1件（まだシートに無い）の座標を探して返す。書き込みはしない */
function resolveCoordsAction_(ss, spot) {
  const r = resolveCoords_(normalizeSpot_(spot), getApiKey_(ss), { n: 0 });
  return r ? { status: 'ok', found: true, coords: r } : { status: 'ok', found: false };
}

/**
 * fillCoords：座標の無いスポットを最大 limit 件（既定20）補完し、見つかった行だけ書き換える。
 * 実行時間の上限（GAS 6分）に備えて約4分で打ち切り、残り件数を返す（アプリが繰り返し呼ぶ）。
 * skipIds：前の回で見つからなかったスポット（同じものを何度も試さない）。
 */
function fillCoords_(ss, req) {
  const started = Date.now();
  const limit = Math.max(1, Math.min(Number(req.limit) || 20, 50));
  const skip = {};
  (req.skipIds || []).forEach(id => { skip[String(id)] = true; });
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const key = getApiKey_(ss);
  const list = readSpots_(ss).filter(s => !hasCoord_(s) && !skip[s.id]);
  const todo = list.slice(0, limit);
  const filled = [], failed = [];
  const nom = { n: 0 };
  for (let i = 0; i < todo.length; i++) {
    if (Date.now() - started > 240000) break;
    const s = todo[i];
    const r = resolveCoords_(s, key, nom);
    if (!r) { failed.push({ id: s.id, name: s.name }); continue; }
    s.lat = String(r.lat); s.lng = String(r.lng); s.coord_source = r.coord_source;
    if (!s.address && r.address) s.address = String(r.address).replace(/^日本、\s*/, '');
    if (!s.prefecture && r.prefecture) s.prefecture = r.prefecture;
    if (!s.city && r.city) s.city = r.city;
    s.updated_at = today_();
    const row = findRowById_(sh, s.id);
    if (row > 0) sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(s)]);
    filled.push(s);
  }
  const done = filled.length + failed.length;
  return { status: 'ok', filled: filled, failed: failed, processed: done, remaining: Math.max(0, list.length - done), apiKey: !!key };
}

// ==================== v2.0 訪問記録（visits） ====================
function readVisits_(ss) {
  const sh = ss.getSheetByName(SHEET_VISITS);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const list = [];
  sh.getRange(2, 1, last - 1, VISIT_HEADERS.length).getValues().forEach(row => {
    if (!row[0]) return;
    const o = {};
    VISIT_HEADERS.forEach((h, i) => { o[h] = cellToString_(row[i]); });
    list.push(o);
  });
  return list;
}

function visitToRow_(v) {
  return VISIT_HEADERS.map(h => (v[h] === null || v[h] === undefined ? '' : String(v[h])));
}

function normalizeVisit_(v) {
  const o = {};
  VISIT_HEADERS.forEach(h => { o[h] = v[h] === null || v[h] === undefined ? '' : String(v[h]).trim(); });
  return o;
}

/** 入力チェック。OK なら空文字、NG ならメッセージ */
function validateVisit_(ss, v) {
  if (!v.spot_id || findRowById_(ss.getSheetByName(SHEET_SPOTS), v.spot_id) < 0) return 'スポットが見つかりません: ' + v.spot_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return '訪問日を yyyy-MM-dd で入れてください';
  if (!/^[1-5]$/.test(v.rating)) return '評価（1〜5）を選んでください';
  if (v.price !== '' && !/^\d+$/.test(v.price)) return '金額は数字（円）で入れてください';
  if (v.people !== '' && !/^[1-9]\d*$/.test(v.people)) return '人数は1以上の数字で入れてください';
  if (v.repeat !== '' && ['◎', '○', '×'].indexOf(v.repeat) < 0) return 'また行きたいかは ◎／○／× のどれかです';
  const photos = v.photos ? v.photos.split('/').filter(String) : [];
  if (photos.length > MAX_PHOTOS) return '写真は ' + MAX_PHOTOS + ' 枚までです';
  return '';
}

function nextVisitNo_(ids) {
  let max = 0;
  ids.forEach(id => { const m = String(id).match(/^V(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return max + 1;
}

function statusFromVisits_(ss, spotId) {
  return readVisits_(ss).some(v => v.spot_id === String(spotId)) ? '行った' : '行きたい';
}

/** スポットの status を訪問ログから再計算し、変わった時だけその1行を書き換える。最新のスポットを返す */
function syncSpotStatus_(ss, spotId) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const row = findRowById_(sh, spotId);
  if (row < 0) return null;
  const vals = sh.getRange(row, 1, 1, SPOT_HEADERS.length).getValues()[0];
  const spot = {};
  SPOT_HEADERS.forEach((h, i) => { spot[h] = cellToString_(vals[i]); });
  const st = statusFromVisits_(ss, spotId);
  if (spot.status !== st) {
    spot.status = st;
    spot.updated_at = today_();
    sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(spot)]);
  }
  return spot;
}

function addVisit_(ss, visit) {
  const sh = ss.getSheetByName(SHEET_VISITS);
  const v = normalizeVisit_(visit);
  const err = validateVisit_(ss, v);
  if (err) return { status: 'error', code: 'VALIDATION', message: err };
  v.visit_id = 'V' + String(nextVisitNo_(readColumn_(sh, 1))).padStart(4, '0');
  v.created_at = today_();
  v.updated_at = v.created_at;
  sh.getRange(sh.getLastRow() + 1, 1, 1, VISIT_HEADERS.length).setNumberFormat('@').setValues([visitToRow_(v)]);
  return { status: 'ok', visit: v, spot: syncSpotStatus_(ss, v.spot_id) };
}

function updateVisit_(ss, visit) {
  const sh = ss.getSheetByName(SHEET_VISITS);
  const v = normalizeVisit_(visit);
  const row = findRowById_(sh, v.visit_id);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象の訪問記録がありません: ' + v.visit_id };
  const err = validateVisit_(ss, v);
  if (err) return { status: 'error', code: 'VALIDATION', message: err };
  const cur = sh.getRange(row, 1, 1, VISIT_HEADERS.length).getValues()[0];
  const oldSpot = cellToString_(cur[VISIT_HEADERS.indexOf('spot_id')]);
  v.created_at = cellToString_(cur[VISIT_HEADERS.indexOf('created_at')]) || today_();
  v.updated_at = today_();
  sh.getRange(row, 1, 1, VISIT_HEADERS.length).setNumberFormat('@').setValues([visitToRow_(v)]);
  const spots = [syncSpotStatus_(ss, v.spot_id)];
  if (oldSpot && oldSpot !== v.spot_id) spots.push(syncSpotStatus_(ss, oldSpot));
  return { status: 'ok', visit: v, spot: spots[0], spots: spots.filter(Boolean) };
}

function deleteVisit_(ss, visitId, deletePhotos) {
  const sh = ss.getSheetByName(SHEET_VISITS);
  const row = findRowById_(sh, visitId);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象の訪問記録がありません: ' + visitId };
  const cur = sh.getRange(row, 1, 1, VISIT_HEADERS.length).getValues()[0];
  const spotId = cellToString_(cur[VISIT_HEADERS.indexOf('spot_id')]);
  const photos = cellToString_(cur[VISIT_HEADERS.indexOf('photos')]).split('/').filter(String);
  sh.deleteRow(row);
  let trashed = 0;
  if (deletePhotos) photos.forEach(id => { if (deletePhoto_(id).status === 'ok') trashed++; });
  return { status: 'ok', visit_id: String(visitId), spot: syncSpotStatus_(ss, spotId), photosTrashed: trashed };
}

// ==================== v2.0 写真（Google Drive） ====================
function getPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 消されていたら作り直す */ }
  }
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * uploadPhoto：アプリ側で長辺1600px・JPEG に圧縮済みの画像（base64）を受け取り、
 * Drive の「スポット帳 写真」に保存して「リンクを知っている全員が閲覧可」にする。
 */
function uploadPhoto_(req) {
  const data = String(req.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!data) return { status: 'error', code: 'VALIDATION', message: '画像データが空です' };
  if (data.length > 8 * 1024 * 1024) return { status: 'error', code: 'TOO_LARGE', message: '画像が大きすぎます（圧縮後 6MB まで）' };
  const name = String(req.name || ('photo-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '.jpg')).replace(/[\/\\]/g, '_');
  const blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', name);
  const file = getPhotoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { status: 'ok', fileId: file.getId() };
}

/** deletePhoto：写真フォルダ内のファイルだけゴミ箱へ移す（他のファイルは触らない） */
function deletePhoto_(fileId) {
  fileId = String(fileId || '');
  if (!fileId) return { status: 'error', code: 'VALIDATION', message: 'fileId が空です' };
  let file;
  try { file = DriveApp.getFileById(fileId); } catch (e) {
    return { status: 'error', code: 'NOT_FOUND', message: '写真が見つかりません: ' + fileId };
  }
  const folderId = getPhotoFolder_().getId();
  let inFolder = false;
  const parents = file.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
  if (!inFolder) return { status: 'error', code: 'FORBIDDEN', message: '写真フォルダ外のファイルは削除できません' };
  file.setTrashed(true);
  return { status: 'ok', fileId: fileId };
}

/**
 * CSV 取り込み（初期投入・Takeout 再取り込み）
 * rows: spots の列名をキーにしたオブジェクト配列（アプリ側で CSV を解析して送る）
 * 既存行と place_id / maps_url（地物ID）が一致するものは追加しない。
 * dedupeWithinBatch=true のときは、同じ取り込み内の重複も1件にまとめる（Takeout用）。
 * 初期投入（spots形式CSV）は false で送るため、CSV の内容・件数はそのまま入る。
 */
function importSpots_(ss, rows, dedupeWithinBatch) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const existing = readSpots_(ss);
  const pidSet = {};
  const urlSet = {};
  const idSet = {};
  existing.forEach(s => {
    if (s.place_id) pidSet[s.place_id] = s.id;
    const k = mapsUrlKey_(s.maps_url);
    if (k) urlSet[k] = s.id;
    idSet[s.id] = true;
  });
  let nextNo = nextIdNumber_(existing.map(s => s.id));
  const batchPid = {};
  const batchUrl = {};
  const toWrite = [];
  const skipped = [];
  const d = today_();

  rows.forEach((raw, i) => {
    const s = normalizeSpot_(raw);
    if (!s.name && !s.maps_url) { skipped.push({ index: i, reason: '店名・URLとも空' }); return; }
    const uk = mapsUrlKey_(s.maps_url);
    if (s.place_id && pidSet[s.place_id]) { skipped.push({ index: i, name: s.name, reason: 'place_id 登録済み（' + pidSet[s.place_id] + '）' }); return; }
    if (uk && urlSet[uk]) { skipped.push({ index: i, name: s.name, reason: 'マップURL 登録済み（' + urlSet[uk] + '）' }); return; }
    if (dedupeWithinBatch) {
      if ((s.place_id && batchPid[s.place_id]) || (uk && batchUrl[uk])) {
        // 同じ取り込み内の重複は、移行元リスト名だけ先の行にまとめる
        const first = batchPid[s.place_id] || batchUrl[uk];
        if (s.source_lists) {
          const lists = first.source_lists ? first.source_lists.split('/') : [];
          s.source_lists.split('/').forEach(l => { if (l && lists.indexOf(l) < 0) lists.push(l); });
          first.source_lists = lists.join('/');
        }
        skipped.push({ index: i, name: s.name, reason: '取り込み内で重複（まとめた）' });
        return;
      }
    }
    if (!/^SP\d+$/.test(s.id) || idSet[s.id]) {
      s.id = formatId_(nextNo++);
    } else {
      nextNo = Math.max(nextNo, Number(s.id.slice(2)) + 1);
    }
    idSet[s.id] = true;
    if (!s.created_at) s.created_at = d;
    if (!s.updated_at) s.updated_at = d;
    if (!s.status) s.status = '行きたい';
    if (!s.google_saved) s.google_saved = '済';
    if (s.place_id) batchPid[s.place_id] = s;
    if (uk) batchUrl[uk] = s;
    toWrite.push(s);
  });

  if (toWrite.length) {
    const start = sh.getLastRow() + 1;
    const values = toWrite.map(spotToRow_);
    sh.getRange(start, 1, values.length, SPOT_HEADERS.length).setNumberFormat('@').setValues(values);
  }
  return {
    status: 'ok',
    added: toWrite.length,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 200),
    total: existing.length + toWrite.length
  };
}

function setConfig_(ss, key, value) {
  key = String(key || '').trim();
  if (!key) return { status: 'error', code: 'VALIDATION', message: 'key が空です' };
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const idx = keys.indexOf(key);
  const row = idx >= 0 ? idx + 2 : last + 1;
  sh.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[key, value === null || value === undefined ? '' : String(value)]]);
  return { status: 'ok', key: key };
}

// ==================== Places API (New) ====================
const PLACES_BASE = 'https://places.googleapis.com/v1/';

function getApiKey_(ss) {
  return readConfigMap_(ss).places_api_key || '';
}

function placesFetch_(url, key, fieldMask, payload) {
  const opt = {
    method: payload ? 'post' : 'get',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    muteHttpExceptions: true
  };
  if (payload) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    throw new Error('Places API エラー (' + code + '): ' + (body.error && body.error.message || res.getContentText()));
  }
  return body;
}

/**
 * searchPlace
 *  - req.query がある → Text Search で候補一覧（place_id・店名・住所・座標・種別）
 *  - req.placeId がある → Details で1件の詳細（住所構成要素・マップURL付き）
 */
function searchPlace_(ss, req) {
  const key = getApiKey_(ss);
  if (!key) return { status: 'error', code: 'NO_API_KEY', message: 'Places APIキーが未設定です（設定タブで登録してください）' };

  if (req.placeId) {
    return { status: 'ok', place: placeDetails_(key, req.placeId) };
  }
  const query = String(req.query || '').trim();
  if (!query) return { status: 'error', code: 'VALIDATION', message: '検索語が空です' };
  const payload = { textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 10 };
  if (req.lat && req.lng) {
    payload.locationBias = { circle: { center: { latitude: Number(req.lat), longitude: Number(req.lng) }, radius: 50000 } };
  }
  const body = placesFetch_(PLACES_BASE + 'places:searchText', key,
    'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType', payload);
  const candidates = (body.places || []).map(p => ({
    place_id: p.id,
    name: p.displayName ? p.displayName.text : '',
    address: p.formattedAddress || '',
    lat: p.location ? p.location.latitude : '',
    lng: p.location ? p.location.longitude : '',
    types: p.types || [],
    primaryType: p.primaryType || ''
  }));
  return { status: 'ok', candidates: candidates };
}

function placeDetails_(key, placeId) {
  const p = placesFetch_(PLACES_BASE + 'places/' + encodeURIComponent(placeId) + '?languageCode=ja&regionCode=JP', key,
    'id,displayName,formattedAddress,location,types,primaryType,addressComponents,googleMapsUri');
  const comps = p.addressComponents || [];
  const pick = type => {
    const c = comps.filter(x => (x.types || []).indexOf(type) >= 0)[0];
    return c ? c.longText : '';
  };
  return {
    place_id: p.id,
    name: p.displayName ? p.displayName.text : '',
    address: p.formattedAddress || '',
    lat: p.location ? p.location.latitude : '',
    lng: p.location ? p.location.longitude : '',
    types: p.types || [],
    primaryType: p.primaryType || '',
    prefecture: pick('administrative_area_level_1'),
    city: pick('locality') || pick('administrative_area_level_2'),
    maps_url: p.googleMapsUri || ('https://www.google.com/maps/place/?q=place_id:' + p.id),
    coord_source: 'Places'
  };
}

// ==================== 入口1：マップURLの解析 ====================
/**
 * resolveUrl：GoogleマップのURL（maps.app.goo.gl 等の短縮URLも可）を展開し、
 *   1) URL に place_id があれば（キー設定時）Details で特定
 *   2) 店名＋座標が取れれば（キー設定時）Text Search で place_id を特定
 *   3) キー未設定なら URL の店名・座標＋Nominatim の逆ジオコーディングで候補を作る
 */
function resolveUrl_(ss, req) {
  const input = String(req.url || '').trim();
  if (!/^https?:\/\//.test(input)) return { status: 'error', code: 'VALIDATION', message: 'URL を貼ってください' };
  const finalUrl = expandUrl_(input);
  const info = parseMapsUrl_(finalUrl);
  info.expandedUrl = finalUrl;
  const key = getApiKey_(ss);

  if (key && info.placeId) {
    const place = placeDetails_(key, info.placeId);
    return { status: 'ok', info: info, candidates: [place], resolvedBy: 'place_id' };
  }
  if (key && info.name) {
    const r = searchPlace_(ss, { query: info.name, lat: info.lat, lng: info.lng });
    if (r.status === 'ok' && r.candidates.length) {
      return { status: 'ok', info: info, candidates: r.candidates, resolvedBy: 'search' };
    }
  }
  // APIを使わない経路（無料）：URL の情報だけで候補を作る
  if (info.lat && info.lng) {
    const geo = reverseGeocode_(info.lat, info.lng);
    return {
      status: 'ok', info: info, resolvedBy: 'url',
      candidates: [{
        place_id: info.placeId || '',
        name: info.name || '',
        address: geo.address || '',
        prefecture: geo.prefecture || '',
        city: geo.city || '',
        lat: info.lat, lng: info.lng, types: [],
        maps_url: input,
        coord_source: 'URL'
      }]
    };
  }
  return {
    status: 'ok', info: info, resolvedBy: 'none',
    candidates: info.name ? [{ place_id: '', name: info.name, address: '', lat: '', lng: '', types: [], maps_url: input, coord_source: '' }] : [],
    message: key ? 'URL からスポットを特定できませんでした' : 'URL に座標が無く、Places APIキーも未設定のため特定できませんでした'
  };
}

function expandUrl_(url) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res;
    try {
      res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch (e) {
      break;
    }
    const code = res.getResponseCode();
    if (code >= 300 && code < 400) {
      const h = res.getHeaders();
      const loc = h.Location || h.location;
      if (!loc) break;
      current = loc.indexOf('http') === 0 ? loc : current.replace(/^(https?:\/\/[^/]+).*$/, '$1') + loc;
      continue;
    }
    break;
  }
  return current;
}

function parseMapsUrl_(url) {
  const info = { name: '', lat: '', lng: '', placeId: '', ftid: '' };
  let u = url;
  try { u = decodeURIComponent(url.replace(/\+/g, ' ')); } catch (e) { /* そのまま */ }
  const pid = u.match(/(?:query_place_id=|place_id[:=])([A-Za-z0-9_-]{20,})/);
  if (pid) info.placeId = pid[1];
  const ftid = u.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) info.ftid = ftid[1];
  // 店のピン座標（!3d緯度!4d経度）を優先し、無ければ地図中心（@緯度,経度）
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = u.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const search = u.match(/\/maps\/search\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const c = pin || q || search || at;
  if (c) { info.lat = Number(c[1]); info.lng = Number(c[2]); }
  const place = u.match(/\/maps\/place\/([^/@?]+)/);
  if (place) info.name = place[1].trim();
  if (!info.name) {
    const qn = u.match(/[?&]q=([^&]+)/);
    if (qn && !/^-?\d+\.\d+,/.test(qn[1])) info.name = qn[1].trim();
  }
  return info;
}

/** Nominatim（OpenStreetMap の無料ジオコーダ）で都道府県・市区町村・住所を得る */
function reverseGeocode_(lat, lng) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ja&zoom=18&lat=' +
      encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'SpotBook-GAS/1.0 (personal use)' } });
    if (res.getResponseCode() !== 200) return {};
    const j = JSON.parse(res.getContentText());
    const a = j.address || {};
    return {
      address: j.display_name || '',
      prefecture: a.province || a.state || '',
      city: a.city || a.town || a.village || a.county || ''
    };
  } catch (e) {
    return {};
  }
}
