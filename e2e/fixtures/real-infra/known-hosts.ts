const hostKey = process.env.DAOFLOW_REAL_INFRA_SSH_HOST_KEY?.trim();

if (
  !hostKey ||
  !/^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521))\s+[^\s]+$/.test(hostKey)
) {
  process.exit(1);
}

// OpenSSH consumes this on an internal pipe. It is never written to disk or surfaced to logs.
process.stdout.write(`daoflow-real-infra ${hostKey}\n`);
