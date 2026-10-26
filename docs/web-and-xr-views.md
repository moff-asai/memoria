# WebとWebXRの思い出ページ

- `/#create`: 場所の思い出。Webはカメラ・環境モデルなしのラベンダー背景。「周辺を更新」で位置を取得し、保存地点に基づく方角に泡を表示する。写真はファイルから選択し、地点と公開同意を確認して残す。
- `/#mine`: 自分の思い出。本人の投稿だけをデモと同じ3列の間隔で表示する。現在地取得なし。PCは9件、スマートフォンは縦3件ずつ、前後のページへ進める。
- `/#demo`: 既存のデモモデル。

最初は泡0個。実データがある場合だけ表示し、サンプル写真を投稿扱いで表示しない。Webでは `getUserMedia` を呼ばない。対応端末の「WebXRで見る」で immersive-ar に入り、現実の環境に重ねる。戻るとWeb表示を再構築する。ARの動作は実機確認が必要。GPSの場所表示では北合わせも必要。

両ページの泡は既存の `createMemoryMaterials`、`createSphereSatellites`、`createBubbleMembranes` を再利用。通常5個、ホバー・XR視線で7個にほどけ、離すと融合する。タップは追加分裂せず写真枚数分の目の高さの等間隔円周へ。XR内の写真はデモと共通の曲面表示・戻る・前後移動を使う。

## 保存と本人の閲覧

自分の思い出は既存の `place_memories` 本人限定SELECTポリシーと非公開Storageの本人限定読み取りを使う。本人IDの絞り込みに加えRLSを適用し、写真パスの所有者も検証して60秒の署名URLを発行する。DB変更・Edge Functionの再デプロイは不要。

匿名セッションが保存されたブラウザーで本人を識別する。ブラウザーデータを消した場合や別ブラウザーでは元の投稿を本人として表示できない場合がある。署名URLの期限等で画像を再取得できないときは更新ボタンで読み直す。

## 検証

```sh
./node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
./node_modules/.bin/vite build
```

`tests/visual/placed-memories.html` は開発サーバー専用の表示検証。同梱の写真を使い、DBやGPSにはアクセスしない。本番ビルドの入口には含めない。
