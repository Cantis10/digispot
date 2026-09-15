import { Text, View } from "react-native";
import QRCode from "./qrcode";
export default function DisplayFolderQR({ passcode }) {
  return (
    <View>
      <Text>Folder QR</Text>
      <QRCode passcode={passcode} />
    </View>
  );
}
