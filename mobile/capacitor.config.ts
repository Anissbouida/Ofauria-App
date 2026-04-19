import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ofauria.app',
  appName: 'Ofauria',
  // Pointe vers le build du client web existant
  webDir: '../client/dist',
  server: {
    // L'app charge les fichiers web embarqués (pas de URL ici)
    // L'API est configurée via VITE_API_URL dans le build du client
    // OWASP MOB-1 : https obligatoire, cleartext desactive (MITM).
    // Pour le dev local avec un backend sur http://10.0.2.2 (emulateur) ou
    // un laptop en clair, definir CAP_ALLOW_CLEARTEXT=1 avant `npx cap sync`.
    androidScheme: 'https',
    cleartext: process.env.CAP_ALLOW_CLEARTEXT === '1',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#D97706', // Couleur ambre/boulangerie
      showSpinner: true,
      spinnerColor: '#FFFFFF',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#D97706',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
