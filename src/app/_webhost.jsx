import { useEffect, useState } from "react";
import { View } from "react-native";
import { NetworkInfo } from "react-native-network-info";
import { startServer, stopServer } from "../../server/server";

export default function Webhost() {
  const [gateway, setGateway] = useState("");

  useEffect(() => {
    async function getGateway() {
      const ip = await NetworkInfo.getIPV4Address();
      setGateway(ip);
    }
    getGateway();
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        console.log("Starting server...");
        const server = await startServer(8080);

        if (!mounted) return;

        console.log("Server:", server);
        const ip = await NetworkInfo.getIPV4Address();
        console.log("Phone IP:", ip);

        // Publish an mDNS service so devices on the LAN can discover it
        // as "digispot._http._tcp.local"
      } catch (err) {
        console.error("Failed to start server:", err);
      }
    })();

    return () => {
      mounted = false;
      stopServer();
    };
  }, []);

  return <View />;
}
