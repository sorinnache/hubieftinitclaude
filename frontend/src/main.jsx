import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider, PageLoader } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import CaseList from "./pages/CaseList";
import ReturnDetail from "./pages/ReturnDetail";
import ServiceDetail from "./pages/ServiceDetail";
import Settings from "./pages/Settings";
import Activity from "./pages/Activity";
import Stock from "./pages/Stock";
import InventoryRun from "./pages/InventoryRun";
import Profit from "./pages/Profit";
import Livrari from "./pages/Livrari";
import ReceiveRun from "./pages/ReceiveRun";
import Depot from "./pages/Depot";
import PublicReturn from "./pages/PublicReturn";
import PublicService from "./pages/PublicService";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function ProtectedBare({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/retur" element={<PublicReturn />} />
      <Route path="/formular-retur" element={<PublicReturn />} />
      <Route path="/service/public" element={<PublicService />} />
      <Route path="/formular-service" element={<PublicService />} />
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/retururi" replace />} />
      <Route path="/retururi" element={<Protected><CaseList kind="return" /></Protected>} />
      <Route path="/retururi/:id" element={<Protected><ReturnDetail /></Protected>} />
      <Route path="/service" element={<Protected><CaseList kind="service" /></Protected>} />
      <Route path="/service/:id" element={<Protected><ServiceDetail /></Protected>} />
      <Route path="/stocuri/intrare" element={<ProtectedBare><ReceiveRun /></ProtectedBare>} />
      <Route path="/stocuri/inventar" element={<ProtectedBare><InventoryRun /></ProtectedBare>} />
      <Route path="/stocuri" element={<Protected><Stock /></Protected>} />
      <Route path="/depozit" element={<Protected><Depot /></Protected>} />
      <Route path="/profit" element={<Protected><Profit /></Protected>} />
      <Route path="/livrari" element={<Protected><Livrari /></Protected>} />
      <Route path="/istoric" element={<Protected><Activity /></Protected>} />
      <Route path="/setari" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/retururi" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
