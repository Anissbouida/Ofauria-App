/**
 * Detection du support Web Bluetooth dans le navigateur courant.
 *
 * Web Bluetooth est dispo sur Chrome / Edge / Opera (desktop + Android).
 * Indisponible sur Safari (iOS et macOS) et Firefox.
 *
 * Ne pas confondre avec la detection Bluetooth tout court : un navigateur
 * peut tourner sur un PC sans BT, on ne peut le savoir qu'en tentant
 * `navigator.bluetooth.requestDevice()` qui throw alors.
 */
export function isWebBluetoothSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'bluetooth' in navigator && typeof (navigator as Navigator & { bluetooth?: unknown }).bluetooth !== 'undefined';
}
