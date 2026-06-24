let client;

async function secretClient() {
  if (!client) {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    client = new SecretManagerServiceClient();
  }
  return client;
}

export async function readSecret(resourceName) {
  const name = String(resourceName || '').trim();
  if (!name) return '';
  const versionName = name.includes('/versions/') ? name : `${name}/versions/latest`;
  const [version] = await (await secretClient()).accessSecretVersion({ name: versionName });
  return version.payload.data.toString('utf8').trim();
}

export async function readSecretFromEnv({ directEnv, secretEnv }) {
  const direct = String(process.env[directEnv] || '').trim();
  if (direct) return direct;
  const secretName = String(process.env[secretEnv] || '').trim();
  if (!secretName) return '';
  return readSecret(secretName);
}
