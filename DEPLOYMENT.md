# Renderへのデプロイ手順

このドキュメントでは、STMOV Viewer WebアプリケーションをRenderにデプロイする手順を説明します。

---

## 📋 目次

1. [デプロイ済み環境](#デプロイ済み環境)
2. [初回デプロイ手順](#初回デプロイ手順)
3. [環境変数の設定](#環境変数の設定)
4. [デプロイ設定ファイル](#デプロイ設定ファイル)
5. [更新方法](#更新方法)
6. [トラブルシューティング](#トラブルシューティング)
7. [コスト・制限事項](#コスト制限事項)

---

## デプロイ済み環境

### 本番環境

- **公開URL**: https://stmov-viewer-web.onrender.com
- **プラン**: Free（無料プラン）
- **リージョン**: Singapore
- **Node.jsバージョン**: 18.x
- **自動デプロイ**: 有効（mainブランチへのプッシュで自動再デプロイ）

### 環境変数

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 本番環境モード |
| `DEBUG_MODE` | `false` | デバッグログを無効化 |
| `PORT` | (自動設定) | Renderが自動設定 |

---

## 初回デプロイ手順

### 前提条件

- GitHubアカウント
- Renderアカウント（無料で作成可能）
- このリポジトリがGitHubにプッシュ済み

### 1. Renderアカウント作成

1. https://render.com にアクセス
2. 「Get Started for Free」をクリック
3. GitHubアカウントで認証

### 2. 新しいWeb Serviceを作成

1. Renderダッシュボードで「New +」→「Web Service」を選択
2. GitHubリポジトリを接続
   - 「Connect a repository」から `stmov-viewer-web` を選択
3. 基本設定を入力:

   | 項目 | 値 |
   |------|-----|
   | Name | `stmov-viewer-web` |
   | Region | `Singapore` (または任意) |
   | Branch | `main` |
   | Runtime | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | `Free` |

### 3. 環境変数を設定

「Environment」セクションで以下を追加:

```
NODE_ENV=production
DEBUG_MODE=false
```

### 4. デプロイ実行

1. 「Create Web Service」をクリック
2. 初回ビルド・デプロイが開始されます（5〜10分程度）
3. デプロイ完了後、公開URLが表示されます

---

## 環境変数の設定

### Renderダッシュボードでの設定方法

1. Renderダッシュボードでサービスを選択
2. 左メニューから「Environment」を選択
3. 「Add Environment Variable」をクリック
4. キーと値を入力して保存

### 必須の環境変数

```bash
NODE_ENV=production
DEBUG_MODE=false
```

### オプションの環境変数（将来的に追加可能）

```bash
# パフォーマンス設定
MAX_CACHED_FRAMES=10
TARGET_FPS=30
```

⚠️ **注意**: 環境変数を変更すると、サービスが自動的に再デプロイされます。

---

## デプロイ設定ファイル

### render.yaml

プロジェクトルートの `render.yaml` ファイルに、Renderのデプロイ設定が記載されています。

```yaml
services:
  - type: web
    name: stmov-viewer-web
    runtime: node
    env: node
    region: singapore
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DEBUG_MODE
        value: false
    healthCheckPath: /health
    autoDeploy: true
```

### package.json

デプロイに必要な設定が追加されています:

```json
{
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "start": "node src/server.js"
  }
}
```

### .nvmrc

Node.jsバージョンを明示的に指定:

```
18
```

---

## 更新方法

### 自動デプロイ（推奨）

`render.yaml` で `autoDeploy: true` が設定されているため、GitHubの `main` ブランチにプッシュすると自動的に再デプロイされます。

```bash
# 変更をコミット
git add .
git commit -m "Update application"

# GitHubにプッシュ（自動デプロイが開始される）
git push origin main
```

### 手動デプロイ

1. Renderダッシュボードでサービスを選択
2. 右上の「Manual Deploy」→「Deploy latest commit」をクリック

### デプロイ状況の確認

1. Renderダッシュボードの「Logs」タブでビルド・デプロイログを確認
2. 「Events」タブでデプロイ履歴を確認

---

## トラブルシューティング

### 問題1: 初回アクセスで「Not Found」エラーが表示される

**原因**:
- デプロイが完了していない
- サービスがスリープ状態から起動中

**解決方法**:
1. Renderダッシュボードの「Logs」タブを確認
2. "Server running on port..." というログが表示されるまで待つ（30秒〜1分）
3. ブラウザを再読み込み

### 問題2: デプロイが失敗する

**原因**:
- `package.json` の設定ミス
- 環境変数の不足
- Node.jsバージョンの不一致

**解決方法**:
1. Renderダッシュボードの「Logs」タブでエラーメッセージを確認
2. `package.json` の `engines` フィールドを確認:
   ```json
   "engines": {
     "node": ">=18.0.0"
   }
   ```
3. 環境変数が正しく設定されているか確認

### 問題3: サービスがスリープから起動しない

**原因**:
- 無料プランでは、15分間非アクティブ状態が続くとスリープします

**解決方法**:
1. 数分待ってから再度アクセス
2. Renderダッシュボードから「Manual Deploy」を実行
3. 有料プラン（$7/月〜）にアップグレードすると常時起動になります

### 問題4: `/health` エンドポイントでエラーが出る

**原因**:
- ヘルスチェック設定が正しくない

**解決方法**:
1. `src/server.js:90` の `/health` エンドポイントが実装されているか確認
2. `render.yaml` の `healthCheckPath: /health` が正しく設定されているか確認

### 問題5: 環境変数が反映されない

**解決方法**:
1. Renderダッシュボードの「Environment」タブで環境変数を確認
2. 変更後、サービスを手動で再デプロイ

---

## コスト・制限事項

### 無料プラン（Free）

**含まれる機能**:
- ✅ 750時間/月の稼働時間
- ✅ SSL/TLS証明書（HTTPS対応）
- ✅ 自動デプロイ
- ✅ カスタムドメイン対応

**制限事項**:
- ⚠️ **15分間非アクティブでスリープ**（起動に30秒〜1分）
- ⚠️ 512MB RAM
- ⚠️ 0.1 CPU
- ⚠️ 月間100GBの帯域幅

### 有料プラン（Starter - $7/月〜）

**改善される点**:
- ✅ **常時起動（スリープなし）**
- ✅ より高いRAM・CPU
- ✅ より多い帯域幅

### アップグレード方法

1. Renderダッシュボードでサービスを選択
2. 「Settings」→「Instance Type」を変更
3. 支払い情報を登録

---

## 参考リンク

- [Render公式ドキュメント](https://render.com/docs)
- [Node.js on Render](https://render.com/docs/deploy-node-express-app)
- [環境変数の設定方法](https://render.com/docs/environment-variables)
- [カスタムドメインの設定](https://render.com/docs/custom-domains)

---

**最終更新**: 2025-10-13
**作成者**: AI（Claude）と非エンジニアの協働開発
