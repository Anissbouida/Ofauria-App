import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ofauria.app',
  appName: 'Ofauria',
  // Pointe vers le build du client web existant
  webDir: '../client/dist',
  server: {
    // L'app charge les fichiers web embarqués (pas de URL ici)
    // L'API est configurée via VITE_API_URL dans le build du client
    androidScheme: 'http',
    cleartext: true,
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
