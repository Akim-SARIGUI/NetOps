<script setup lang="ts">
definePageMeta({ layout: "blank" });

const email = ref("admin@netops.local");
const password = ref("NetOps-Demo-2026!");
const message = ref("");
const pending = ref(false);

const accounts = [
  ["superadmin@netops.local", "SUPER_ADMIN"],
  ["admin@netops.local", "NETWORK_ADMIN"],
  ["operator@netops.local", "NETWORK_OPERATOR"],
  ["auditor@netops.local", "AUDITOR"],
  ["viewer@netops.local", "VIEWER"],
];

async function submit() {
  message.value = "";
  pending.value = true;
  try {
    await $fetch("/api/backend/auth/login", {
      method: "POST",
      body: { email: email.value, password: password.value },
    });
    await navigateTo("/dashboard");
  } catch (error) {
    message.value = apiErrorMessage(error);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section class="login-screen">
    <div class="login-copy">
      <h1>NetOps</h1>
      <p>Plateforme professionnelle de gestion d'infrastructure réseau : inventaire, adressage, services, supervision et automatisation.</p>
    </div>
    <div class="login-card">
      <form class="panel" @submit.prevent="submit">
        <h2>Connexion</h2>
        <p v-if="message" class="banner">{{ message }}</p>
        <label>
          E-mail
          <input v-model="email" type="email" autocomplete="username" required />
        </label>
        <label>
          Mot de passe
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="primary" type="submit" :disabled="pending">Entrer</button>
        <div class="accounts hint">
          <p>Comptes de démonstration, mot de passe commun <span class="mono">NetOps-Demo-2026!</span></p>
          <ul>
            <li v-for="account in accounts" :key="account[0]">
              <span class="mono">{{ account[0] }}</span> — {{ account[1] }}
            </li>
          </ul>
        </div>
      </form>
    </div>
  </section>
</template>
