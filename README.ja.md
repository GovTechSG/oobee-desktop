# Oobee

[English](./README.md) | **日本語**

Oobee（旧称 Purple A11y）は、アクセシビリティ サイトスキャナーです。カスタマイズ可能な自動 Web アクセシビリティテストツールで、ソフトウェア開発チームがアクセシビリティの問題を発見・修正し、障害のある方（PWD）がデジタルサービスを利用しやすくすることを支援します。公式アプリケーションは [https://go.gov.sg/oobee](https://go.gov.sg/oobee) からのみダウンロードできます。他の入手元やサードパーティのリンクはシステムに危険を及ぼすおそれがあるため、必ず公式リンクからダウンロードしてください。

Oobee をコマンドラインで実行したいソフトウェアエンジニアの方は、[Oobee (CLI)](https://github.com/GovTechSG/oobee) を参照してください。

[![DPG Badge](https://img.shields.io/badge/Verified-DPG-3333AB?logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMzEiIGhlaWdodD0iMzMiIHZpZXdCb3g9IjAgMCAzMSAzMyIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE0LjIwMDggMjEuMzY3OEwxMC4xNzM2IDE4LjAxMjRMMTEuNTIxOSAxNi40MDAzTDEzLjk5MjggMTguNDU5TDE5LjYyNjkgMTIuMjExMUwyMS4xOTA5IDEzLjYxNkwxNC4yMDA4IDIxLjM2NzhaTTI0LjYyNDEgOS4zNTEyN0wyNC44MDcxIDMuMDcyOTdMMTguODgxIDUuMTg2NjJMMTUuMzMxNCAtMi4zMzA4MmUtMDVMMTEuNzgyMSA1LjE4NjYyTDUuODU2MDEgMy4wNzI5N0w2LjAzOTA2IDkuMzUxMjdMMCAxMS4xMTc3TDMuODQ1MjEgMTYuMDg5NUwwIDIxLjA2MTJMNi4wMzkwNiAyMi44Mjc3TDUuODU2MDEgMjkuMTA2TDExLjc4MjEgMjYuOTkyM0wxNS4zMzE0IDMyLjE3OUwxOC44ODEgMjYuOTkyM0wyNC44MDcxIDI5LjEwNkwyNC42MjQxIDIyLjgyNzdMMzAuNjYzMSAyMS4wNjEyTDI2LjgxNzYgMTYuMDg5NUwzMC42NjMxIDExLjExNzdMMjQuNjI0MSA5LjM1MTI3WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg==)](https://digitalpublicgoods.net/r/oobee)

<img alt="Oobee Desktop のメイン画面" src="https://github.com/user-attachments/assets/3992115c-d237-4d66-b247-a541a2a49f9e">

> この日本語版は英語版 [README.md](./README.md) の翻訳です。内容に差異がある場合は英語版が優先されます。

## 技術スタック

1. [Electron](https://www.electronjs.org/)
2. [React](https://react.dev/)

## インストール

### Oobee のダウンロード

Oobee は Windows および macOS 向けに提供されています。詳しい手順は[インストールガイド](/INSTALLATION.md)（英語）を参照してください。

### 開発・ビルド・テスト

#### Node.js の要件
- Node LTS（24.22.1）を推奨します。`npm` と `node` コマンドが `PATH` で利用できることを前提としています。
- インターネットへの直接接続が必要です。企業の IT 環境では、証明書の問題により一部の node モジュールのダウンロードに失敗する場合があります。

#### エンジンのバージョン設定

まずターミナルを開き、Oobee をクローンしたリポジトリの場所に移動します。
次に、ダウンロードする Oobee CLI Portable のバージョンを環境変数 BE_TAG で指定します（下記参照）。BE_TAG の `0.10.68` は目的のバージョンに置き換えてください。

#### スタンドアロンアプリのビルド

##### Mac の場合

```shell
npm install
export BE_TAG=0.10.68
npm run make-mac
```

リポジトリの _out_ フォルダー内にフォルダーが作成されます。
../out に作成されたフォルダー内の `Oobee.app` を実行してください。

##### Windows の場合

```shell
npm install -g win-node-env
npm install
$env:BE_TAG=0.10.68
npm run make-win
```

##### Mac / Windows でビルドしたアプリに関する補足
- `npm run make-mac` でビルドした Mac 版アプリには、Oobee バックエンドの zip が同梱されます。Oobee.app を実行すると「セットアップ中」画面で、同梱の `oobee-portable-mac.zip` のバージョンと展開済みのバージョンを確認し、一致しない場合は `Oobee.app/Contents/oobee-portable-mac.zip` を `~/Library/Application Support/Oobee/Oobee Backend` に展開します。
- Windows 版の開発アプリには Oobee バックエンドが含まれません。Oobee (CLI) Portable が `C:\Program Files\Oobee Desktop\Oobee Backend` または `%APPDATA%\Oobee Desktop\Oobee Backend` に展開済みであることを前提としています。
- Windows のインストーラー（exe）は InnoSetup を使用してビルドされます（GitHub Actions による自動ビルドパイプライン）。

#### 実行とデバッグ（開発）

以下の開発用コマンドを使うと、ターミナルに STDOUT ログを表示しながら Oobee アプリをデバッグできます。

次のコードを実行して Oobee をビルドします。

##### Mac の場合

```shell
npm install
npm run make-mac
```

##### Windows の場合
```shell
npm install -g win-node-env
npm install
npm run build
```

##### 開発アプリの起動
最後に、次のコードを入力して Oobee を起動します。

```shell
npm run start
```

##### Mac / Windows での開発に関する補足
- Mac 版の開発アプリには Oobee Portable バックエンドが含まれません。Oobee (CLI) Portable が `~/Library/Application Support/Oobee/Oobee Backend` に展開済みであることを前提としています。
- Windows 版の開発アプリには Oobee Portable バックエンドが含まれません。Oobee (CLI) Portable が `C:\Program Files\Oobee Desktop\Oobee Backend` または `%APPDATA%\Oobee Desktop\Oobee Backend` に展開済みであることを前提としています。

指定したバージョンのアプリケーションウィンドウが開きます。ターミナル / PowerShell ウィンドウからアプリをデバッグできます。

#### 問題が発生した場合

[Issue](https://github.com/GovTechSG/oobee-desktop/issues) を作成してお問い合わせください。

---

## 基本的な使い方

スキャンする有効な URL をテキストボックスに入力し、「スキャン」ボタンを押します。既定の設定では、ウェブサイトをクロールして 100 ページのアクセシビリティの問題をスキャンします。

![Oobee Desktop のメインページ](https://github.com/user-attachments/assets/94d19cf8-88e4-46c3-b5d6-647b7c615a6e)

## スキャンするページ数の制限

ウェブサイトが大きくスキャンに時間がかかりすぎる場合や、サイトマップ内のページが多すぎる場合は、スキャンするページ数を制限できます。ドロップダウンをクリックし、スキャンするページ数を入力してください。

![スキャンするページ数の制限](https://github.com/user-attachments/assets/b0180bd4-bd98-44f8-a8ea-9f73f29b7538)

## 詳細スキャンオプション

「詳細スキャンオプション」ボタンをクリックすると、スキャンオプションを設定できます。

![詳細スキャンオプション](https://github.com/user-attachments/assets/58bbbf47-30f6-4751-bbb8-b8d6243f5187)

### スキャンタイプの選択

#### ウェブサイトクロール

Oobee の既定のスキャンオプションです。指定した URL のドメイン内にあるすべてのリンクを（ページ数の上限まで）クロールしてスキャンします。

#### サイトマップクロール

サイトマップファイルの URL（例: `https.domain.com/sitemap.xml`）を指定すると、指定した URL のドメイン内にあるすべてのリンクを（ページ数の上限まで）クロールしてスキャンします。

#### カスタムフロー

カスタムフローは、シングルページアプリケーション（SPA）やウェブサイトのスキャンに使用します。各ページのスキャンは、ユーザーが「_このページをスキャン_」（_`Scan this page`_）ボタンをクリックすることで開始されます。対象のユーザーフローのスキャンが完了したら、ブラウザーを閉じるとカスタムフローレポートが自動的に生成されます。

![カスタムフローのスクリーンショット](https://github.com/user-attachments/assets/9055ad9c-5dee-47a2-a01e-4d4d91be88cc)

### ビューポートのオプション

デスクトップおよびモバイル端末のユーザー向けにウェブサイトを表示するよう、ビューポートのオプションを設定できます。

#### デスクトップ

既定の画面サイズは 1280x720 です。

#### モバイル

既定の画面サイズは iPhone 11 です。

#### 特定のデバイス

<details>
  <summary>対応デバイスの一覧を表示するにはクリックしてください</summary>

- Blackberry PlayBook
- Blackberry PlayBook landscape
- BlackBerry Z30
- BlackBerry Z30 landscape
- Galaxy Note 3
- Galaxy Note 3 landscape
- Galaxy Note II
- Galaxy Note II landscape
- Galaxy S III
- Galaxy S III landscape
- Galaxy S5
- Galaxy S5 landscape
- Galaxy S8
- Galaxy S8 landscape
- Galaxy S9+
- Galaxy S9+ landscape
- Galaxy Tab S4
- Galaxy Tab S4 landscape
- iPad (gen 5)
- iPad (gen 5) landscape
- iPad (gen 6)
- iPad (gen 6) landscape
- iPad (gen 7)
- iPad (gen 7) landscape
- iPad Mini
- iPad Mini landscape
- iPad Pro 11
- iPad Pro 11 landscape
- iPhone 6
- iPhone 6 landscape
- iPhone 6 Plus
- iPhone 6 Plus landscape
- iPhone 7
- iPhone 7 landscape
- iPhone 7 Plus
- iPhone 7 Plus landscape
- iPhone 8
- iPhone 8 landscape
- iPhone 8 Plus
- iPhone 8 Plus landscape
- iPhone SE
- iPhone SE landscape
- iPhone X
- iPhone X landscape
- iPhone XR
- iPhone XR landscape
- iPhone 11
- iPhone 11 landscape
- iPhone 11 Pro
- iPhone 11 Pro landscape
- iPhone 11 Pro Max
- iPhone 11 Pro Max landscape
- iPhone 12
- iPhone 12 landscape
- iPhone 12 Pro
- iPhone 12 Pro landscape
- iPhone 12 Pro Max
- iPhone 12 Pro Max landscape
- iPhone 12 Mini
- iPhone 12 Mini landscape
- iPhone 13
- iPhone 13 landscape
- iPhone 13 Pro
- iPhone 13 Pro landscape
- iPhone 13 Pro Max
- iPhone 13 Pro Max landscape
- iPhone 13 Mini
- iPhone 13 Mini landscape
- iPhone 14
- iPhone 14 landscape
- iPhone 14 Plus
- iPhone 14 Plus landscape
- iPhone 14 Pro
- iPhone 14 Pro landscape
- iPhone 14 Pro Max
- iPhone 14 Pro Max landscape
- iPhone 15
- iPhone 15 landscape
- iPhone 15 Plus
- iPhone 15 Plus landscape
- iPhone 15 Pro
- iPhone 15 Pro landscape
- iPhone 15 Pro Max
- iPhone 15 Pro Max landscape
- Kindle Fire HDX
- Kindle Fire HDX landscape
- LG Optimus L70
- LG Optimus L70 landscape
- Microsoft Lumia 550
- Microsoft Lumia 550 landscape
- Microsoft Lumia 950
- Microsoft Lumia 950 landscape
- Nexus 10
- Nexus 10 landscape
- Nexus 4
- Nexus 4 landscape
- Nexus 5
- Nexus 5 landscape
- Nexus 5X
- Nexus 5X landscape
- Nexus 6
- Nexus 6 landscape
- Nexus 6P
- Nexus 6P landscape
- Nexus 7
- Nexus 7 landscape
- Nokia Lumia 520
- Nokia Lumia 520 landscape
- Nokia N9
- Nokia N9 landscape
- Pixel 2
- Pixel 2 landscape
- Pixel 2 XL
- Pixel 2 XL landscape
- Pixel 3
- Pixel 3 landscape
- Pixel 4
- Pixel 4 landscape
- Pixel 4a (5G)
- Pixel 4a (5G) landscape
- Pixel 5
- Pixel 5 landscape
- Pixel 7
- Pixel 7 landscape
- Moto G4
- Moto G4 landscape
- Desktop Chrome HiDPI
- Desktop Chrome

</details>

### カスタム幅

幅をピクセル単位で入力します。最小幅は 320px、最大幅は 1080px です。

## レポート

サイトのスキャンが完了すると、

レポートが ../Documents フォルダーにダウンロードされます。

レポートの保存先へのリンクが表示されます。リンクをクリックするとレポートの保存場所を開けます。

「レポートを表示」ボタンをクリックして、アクセシビリティスキャンの結果を確認することもできます。

## アクセシビリティスキャンの結果

どのスキャン結果が「Must Fix（必ず修正）」/「Good to Fix（修正推奨）」に該当するかについては、[Scan Issue Details](https://github.com/GovTechSG/oobee/blob/master/DETAILS.md)（英語）を参照してください。

## システムコンテキスト図

<img alt="Oobee のシステムコンテキスト図" src="https://github.com/user-attachments/assets/31c7ac61-f242-4c5f-baf3-e2ed120fe1cb">

Oobee のバックエンドリポジトリ、およびコマンドラインでの実行方法については、[Oobee (CLI)](https://github.com/GovTechSG/oobee) を参照してください。

## データに関する追加情報

Oobee は、インストール時にインターネット経由でダウンロードされる場合があるサードパーティのオープンソースツールを使用しています。使用しているライブラリは `package.json` で確認できます。

Oobee は、ユーザーがスキャンを開始したウェブサイトまたは URL に情報を送信する場合があります。利用状況を把握する目的で、メールアドレス、氏名、基本的な分析データなど、限られたユーザー情報を収集します。

### テレメトリーの無効化（シンガポール国外）

OS の地域がシンガポール以外に設定されている場合（macOS: **システム設定 → 一般 → 言語と地域 → 地域**、Windows: **設定 → 時刻と言語 → 言語と地域 → 国または地域**）、オンボーディング画面と「**プロフィールの編集**」ダイアログに「**アクセシビリティスキャンのテレメトリーを無効にする**」オプションが表示されます。このオプションを選択すると、次のようになります。

- お名前とメールアドレスは消去され、収集されません。
- スキャンは `OOBEE_DISABLE_TELEMETRY=true` で実行され、Oobee エンジンはスキャンのテレメトリーを送信しません。
- Oobee Desktop はアプリの利用状況やクラッシュレポートの送信を停止します（Sentry は起動しません）。

テレメトリーは「**プロフィールの編集**」から再び有効にできます。Oobee を再起動すると再開されます。

## 言語

Oobee Desktop は英語と日本語に対応しています。OS の優先言語または地域の形式が日本語の場合（macOS: **言語と地域**、Windows: **Windows の表示言語**または**地域設定**）、画面は日本語で表示されます。それ以外の場合は英語で表示されます。
