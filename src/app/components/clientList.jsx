import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { getClients } from "../../../server/server";

export default function ClientList() {
  const [clients, setClients] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const data = getClients();

      setClients(data);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <View>
      <Text>Client List</Text>
      <View>
        {clients.length > 0 ? (
          clients.map((client, index) => <Text key={index}>{client.name}</Text>)
        ) : (
          <Text>No clients available.</Text>
        )}
      </View>
    </View>
  );
}
