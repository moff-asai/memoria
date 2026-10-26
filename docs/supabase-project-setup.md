# 新しいSupabaseへの接続

対象プロジェクト: `niaopqpzpwrfhfwzllzs`
URL: `https://niaopqpzpwrfhfwzllzs.supabase.co`

## 現在の状態

公開キーを `.env.local` に設定し、再ビルド済みです。2026-10-26の読み取り確認では、匿名認証は有効でした。`private_locations`・`place_memories` と `nearby_place_memories` RPCは存在し、未認証の直接アクセスは401 / 42501で拒否されました。`place-memories` Edge Functionのデプロイを確認済みです。localhost:3000からのOPTIONSは204、許可オリジンは `http://127.0.0.1:3000`、未認証のstatus呼び出しは関数内で401（匿名認証が必要）になります。Storage設定と認証後の動作は未確認です。実位置や写真は送信せず、匿名ユーザーも作成していません。旧キー・セッション・共有APIは使いません。既存データは移行せず、デモの同梱写真・個数・円周配置を保持しています。

## 利用者側で行う設定

### 1. ログインして匿名認証を有効化（反映確認済み）

[Authentication > Sign In / Providers](https://supabase.com/dashboard/project/niaopqpzpwrfhfwzllzs/auth/providers) を開き、**Allow anonymous sign-ins** を有効にして保存します。表示名はDashboardの更新で異なる場合があります。[公式手順](https://supabase.com/docs/guides/auth/auth-anonymous)

匿名ユーザーも `authenticated` ロールになります。下記の本人限定RLSを併せて適用してください。ブラウザーのデータ消去・別端末では同じ匿名アカウントに戻れないことがあります。

### 2. 公開キーを設定（ローカル反映済み）

[Settings > API Keys](https://supabase.com/dashboard/project/niaopqpzpwrfhfwzllzs/settings/api-keys) から **Publishable key** (`sb_publishable_…`) をコピーします。旧形式の場合は、このプロジェクトの **anon public** キーも使えます。**Secret key / service_role はフロントエンドにもチャットにも渡しません。** [キーの公式説明](https://supabase.com/docs/guides/getting-started/api-keys)

プロジェクト直下の `.env.local` に記載します（`.env.example` は見本です）。

```dotenv
VITE_SUPABASE_PUBLISHABLE_KEY=ここにコピーした公開キー
```

この変数は今回追加したアプリ用の設定です。URLはコードで対象プロジェクトに固定しています。Viteではビルド時に取り込まれるため、設定後に再ビルドが必要です。公開キーをこちらに知らせればローカルへの反映を続けられます。

### 3. SQLを反映（現在はテーブル・位置検索関数の存在を確認済み）

[SQL Editor](https://supabase.com/dashboard/project/niaopqpzpwrfhfwzllzs/sql/new) に `supabase/setup-new-project.sql` の内容を貼り付け、対象がこの新プロジェクトであることを確認して実行します。これは次の3ファイルを順に連結したものです。

1. `supabase/migrations/202610260001_private_locations.sql`
2. `supabase/migrations/202610260002_place_memories.sql`
3. `supabase/migrations/202610260003_place_memories_geography.sql`

初回用です。現在は両テーブルと位置検索関数の存在を確認済みのため、この初回SQLは再実行せず4番へ進みます。`42P07: relation "private_locations" already exists` は作成済みのテーブルを再作成したエラーです。既存テーブルを削除してやり直す必要はありません。部分適用の場合は適用状況を調べ、未適用のSQLだけを実行してください。PostGISが既に別スキーマに存在する場合は3番が停止するため、そのエラーを確認してから調整します。位置情報テーブル・写真用非公開バケット・本人限定RLS・50m検索が作成されます。

### 4. 新しいEdge Functionをデプロイ（反映確認済み）

Macのターミナルで次を実行します。`login` は本人のブラウザー認証が必要です。既存 `server` はデプロイしません。

```sh
cd /Users/moff_asai/Documents/github/memoria
npx supabase login
npx supabase functions deploy place-memories --project-ref niaopqpzpwrfhfwzllzs
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は関数のサーバー環境でSupabaseが提供する値を使用します。ローカルの `.env.local` にサービスロールを入れる必要はありません。JWT検証は既定で有効のままにし、関数内でも `auth.getUser` で本人確認します。

localhost:3000 / 127.0.0.1:3000 は許可済みです。公開URLを使う時は、関数のSecret `MEMORIA_ALLOWED_ORIGINS` にカンマ区切りで許可するHTTPSオリジンを設定します。

### 5. 再ビルドと動作確認

```sh
cd /Users/moff_asai/Documents/github/memoria
./node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
./node_modules/.bin/vite build
```

プレビューを再読み込みし、**場所の思い出 > 周辺を更新** で利用者自身が位置情報を許可します。匿名ユーザー作成、最新位置の保存、周辺検索の順に進みます。写真は公開確認までアップロードされません。最初は他の投稿がないため泡0個が正常です。GPS・方位・WebXRは対応実機のHTTPS上でも確認してください。通常Webではカメラを使いません。

公開前には匿名認証のレート制限と、画面側のチャレンジ実装を含むCAPTCHA対応が必要です。詳細は [場所付き思い出の仕様](place-memories-setup.md) を参照してください。
