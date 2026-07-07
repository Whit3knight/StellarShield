import * as React from "react"

import { DESKTOP_MEDIA_QUERY } from "../constants"

function getIsDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  )
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(getIsDesktop)

  React.useEffect(() => {
    const mediaQueryList = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const handleChange = () => {
      setIsDesktop(mediaQueryList.matches)
    }

    handleChange()
    mediaQueryList.addEventListener("change", handleChange)

    return () => {
      mediaQueryList.removeEventListener("change", handleChange)
    }
  }, [])

  return isDesktop
}
