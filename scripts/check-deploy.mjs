import { loadDeployment } from "./deploy-config.mjs";
try {
  if (process.argv.length !== 3)
    throw Error("Usage: npm run deploy:check -- /etc/kivo/deploy.env");
  await loadDeployment(process.argv[2]);
  console.log(
    "PASS: deployment fields, credential boundaries, Auth0 origins, Neon targets and file permissions. No cloud calls were made.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
