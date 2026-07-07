import { AppDashboard } from "./_components/app-dashboard"
import { AppNavbar } from "./_components/app-navbar"

export default function Page(): React.ReactElement {
  return (
    <>
      <AppNavbar />
      <AppDashboard />
    </>
  )
}
