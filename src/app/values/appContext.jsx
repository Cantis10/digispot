import { createContext, useState } from "react";

export const AppContext = createContext();

export function AppProvider({ children }) {
  const [value, setValue] = useState(55);

  return (
    <AppContext.Provider value={{ value, setValue }}>
      {children}
    </AppContext.Provider>
  );
}
