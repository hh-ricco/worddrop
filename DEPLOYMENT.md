# 部署到 Cloudflare Pages 指南

## 方法一：通过 GitHub 连接（推荐）

这是最简单的方法，无需任何本地操作。

### 步骤：

1. **打开 Cloudflare 控制面板**
   - 访问 [dashboard.cloudflare.com](https://dashboard.cloudflare.com)
   - 登录你的 Cloudflare 账户

2. **创建 Pages 项目**
   - 选择 **Pages** 
   - 点击 **连接到 Git**
   - 选择 **GitHub**
   - 授权 Cloudflare 访问你的 GitHub 账户
   - 选择 `hh-ricco/worddrop` 仓库

3. **配置构建设置**
   - **项目名称**：`worddrop` （或任意名称）
   - **生产分支**：`main`
   - **构建命令**：留空
   - **构建输出目录**：`.` （根目录）
   - **根目录**：`.`

4. **保存并部署**
   - 点击 **保存并部署**
   - 等待部署完成（通常 1-2 分钟）
   - 访问你的网站：`https://worddrop.pages.dev`

### 自动部署

部署完成后，每当你向 `main` 分支推送更改时，Cloudflare Pages 会自动重新部署。

---

## 方法二：使用 Wrangler CLI（本地部署）

如果你想在本地完全控制部署过程。

### 前置条件

1. **安装 Node.js 和 Wrangler**
   ```bash
   npm install -g @cloudflare/wrangler
   ```

2. **获取 Cloudflare 凭证**
   - 访问 [Cloudflare API 令牌页面](https://dash.cloudflare.com/profile/api-tokens)
   - 创建一个具有 **Pages Deploy** 权限的 API Token
   - 复制你的账户 ID（在 URL 中或控制面板中可见）

### 部署步骤

1. **验证 Wrangler**
   ```bash
   wrangler login
   ```
   或设置环境变量：
   ```bash
   export CLOUDFLARE_API_TOKEN="your-api-token"
   ```

2. **部署项目**
   ```bash
   cd /Users/longhh/Desktop/paper\ clip
   wrangler pages deploy . --project-name=worddrop
   ```

3. **验证部署**
   - 访问 `https://worddrop.pages.dev`
   - 检查游戏是否正常运行

---

## 方法三：使用 GitHub Actions（自动 CI/CD）

这个项目已经配置了 GitHub Actions 工作流。

### 设置步骤

1. **在 GitHub 仓库中添加 Secrets**
   - 进入 **Settings** → **Secrets and variables** → **Actions**
   - 添加两个 secret：
     - `CLOUDFLARE_API_TOKEN`：你的 Cloudflare API Token
     - `CLOUDFLARE_ACCOUNT_ID`：你的账户 ID

2. **推送更改**
   ```bash
   git add .
   git commit -m "添加 Cloudflare Pages 部署配置"
   git push origin main
   ```

3. **自动部署**
   - GitHub Actions 会自动运行
   - 在 **Actions** 标签页中查看部署状态
   - 成功后访问网站

---

## 常见问题

### Q: 我的域名是什么？
A: Cloudflare Pages 会自动分配 `worddrop.pages.dev`。如果你想使用自己的域名，需要在 Cloudflare 中配置 DNS。

### Q: 部署后游戏无法加载单词？
A: 检查以下几点：
- Service Worker 是否正常加载
- YAML 文件的 CORS 设置是否正确
- 浏览器控制台是否有错误信息

### Q: 如何更新已部署的版本？
A: 只需向 `main` 分支推送更改，Cloudflare Pages 会自动重新部署。

### Q: 离线功能是否能在 Cloudflare Pages 上工作？
A: 是的，Service Worker 会被正确缓存。第一次访问后，应用可以离线使用。

---

## 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
