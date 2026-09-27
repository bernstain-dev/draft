import { Navigate, Route, Routes } from 'react-router-dom';
import { StaffAuthProvider } from './pages/appointments/auth/staffAuth';
import { PatientAuthProvider } from './pages/patient/auth/patientAuth';
import { ThemeProvider } from './lib/theme';
import StaffLogin from './pages/appointments/StaffLogin';
import StaffLayout from './pages/appointments/StaffLayout';
import Dashboard from './pages/appointments/Dashboard';
import Patients from './pages/appointments/Patients';
import Doctors from './pages/appointments/Doctors';
import Booking from './pages/appointments/Booking';
import CheckIn from './pages/appointments/CheckIn';
import Reports from './pages/appointments/Reports';
import Settings from './pages/appointments/Settings';
import PatientLogin from './pages/patient/PatientLogin';
import PatientLayout from './pages/patient/PatientLayout';
import PatientDashboard from './pages/patient/Dashboard';
import BookAppointment from './pages/patient/BookAppointment';
import MyAppointments from './pages/patient/MyAppointments';
import AppointmentHistory from './pages/patient/AppointmentHistory';
import PatientProfile from './pages/patient/Profile';

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/patient/login" replace />} />

        {/* Staff section — appointment scheduling and management */}
        <Route
          path="/appointments/*"
          element={
            <StaffAuthProvider>
              <Routes>
                <Route path="login" element={<StaffLogin />} />
                <Route element={<StaffLayout />}>
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="patients" element={<Patients />} />
                  <Route path="doctors" element={<Doctors />} />
                  <Route path="booking" element={<Booking />} />
                  <Route path="check-in" element={<CheckIn />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="settings" element={<Settings />} />
                  <Route index element={<Navigate to="dashboard" replace />} />
                </Route>
              </Routes>
            </StaffAuthProvider>
          }
        />

        {/* Patient section — book and manage own appointments */}
        <Route
          path="/patient/*"
          element={
            <PatientAuthProvider>
              <Routes>
                <Route path="login" element={<PatientLogin />} />
                <Route element={<PatientLayout />}>
                  <Route path="dashboard" element={<PatientDashboard />} />
                  <Route path="book" element={<BookAppointment />} />
                  <Route path="appointments" element={<MyAppointments />} />
                  <Route path="history" element={<AppointmentHistory />} />
                  <Route path="profile" element={<PatientProfile />} />
                  <Route path="settings" element={<PatientProfile showSettings />} />
                  <Route index element={<Navigate to="dashboard" replace />} />
                </Route>
              </Routes>
            </PatientAuthProvider>
          }
        />

        {/* Legacy queue-board URLs (feature removed): send patients to login */}
        <Route path="/queue-board/*" element={<Navigate to="/patient/login" replace />} />

        <Route path="*" element={<Navigate to="/patient/login" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
