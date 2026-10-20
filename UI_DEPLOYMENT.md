# UI build and deployment

The UI pipeline is automatic. Open a pull request to `main` to run checks without deploying. When a change is pushed to `main`, GitHub Actions runs CI first; only a successful CI run starts the VPS deployment.

CI lints the citizen app, builds the citizen app, admin dashboard, and landing site, then opens all three built frontends in Chromium at desktop and mobile sizes. The smoke tests verify that login, signup, the landing page, and dashboard login render; their JavaScript and CSS load; and the pages do not crash. The deploy workflow repeats the browser smoke test using the production build and checks Nginx routes and assets after upload.

## Required GitHub Actions secrets

Configure these under **Repository Settings → Secrets and variables → Actions → Repository secrets**:

- `DEPLOY_SSH_KEY`: private SSH key authorized on the VPS.
- `VPS_HOST`: SSH destination, such as `root@your-vps-host`.
- `VPS_HOST_ADDR`: host or IP used to add the VPS SSH host key.

Do not put secret values in this file, source code, build output, or chat. The production Supabase public URL and anon key are read by the deploy workflow from the VPS environment file and injected only into the production frontend build. CI uses non-production placeholders.

## What the deploy workflow does

After CI succeeds on a push to `main`, the workflow builds with the production Supabase settings, normalizes web directories to `755` and files to `644`, uploads the frontends and Nginx configuration, validates Nginx, reloads it, and checks that the HTML plus referenced JavaScript and CSS are served successfully. It then runs the same browser smoke checks against the public site. Backend function and migration deployment steps remain in the same workflow.

No manual build, `scp`, `docker cp`, or Nginx reload is needed for routine changes. A manual deployment can be started from **GitHub → Actions → Deploy → Run workflow**.

## If a workflow fails

Check the **CI** run first. A failed CI run intentionally blocks automatic deployment. If CI passes but deployment fails, inspect the **Deploy** job logs, confirm the three repository secrets above, then check the Nginx configuration and the reported route or asset. For a blank page, verify that JS/CSS requests are HTTP 200 and that directories/files are readable by Nginx (`755`/`644`).
