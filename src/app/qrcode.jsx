import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NetworkInfo } from "react-native-network-info";
import QRCode from "react-native-qrcode-svg";

export default function QrCode({ passcode }) {
  const [ip, setIp] = useState("");

  useEffect(() => {
    async function getIPGateway() {
      const gatewayIp = await NetworkInfo.getIPV4Address();
      console.log("Gateway IP:", gatewayIp);
      setIp(gatewayIp);
    }

    getIPGateway();
  }, []);

  return (
    <View style={styles.container}>
      {ip ? (
        passcode ? (
          <>
            <QRCode
              value={`http://${ip}:8080\?password=${passcode}`}
              size={200}
            />
            <Text style={styles.url}>
              http://${ip}:8080?password={passcode}
            </Text>
          </>
        ) : (
          <>
            <QRCode value={`http://${ip}:8080`} size={200} />
            <Text style={styles.url}>http://${ip}:8080</Text>
          </>
        )
      ) : (
        <Text>Getting IP...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 12 },
  url: { color: "#555555", fontSize: 13, textAlign: "center" },
});
