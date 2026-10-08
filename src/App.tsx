import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './app/Shell'
import { Loading } from './components/ui'
import Landing from './pages/Landing'
import Login from './pages/Login'

const Home = lazy(() => import('./pages/Home'))
const Chat = lazy(() => import('./pages/Chat'))
const Kb = lazy(() => import('./pages/Kb'))
const Product = lazy(() => import('./pages/Product'))
const Brand = lazy(() => import('./pages/Brand'))
const News = lazy(() => import('./pages/News'))
const Review = lazy(() => import('./pages/Review'))
const Files = lazy(() => import('./pages/Files'))
const Integrations = lazy(() => import('./pages/Integrations'))
const Team = lazy(() => import('./pages/Team'))
const Gaps = lazy(() => import('./pages/Gaps'))
const Settings = lazy(() => import('./pages/Settings'))

const page = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<Shell />}>
        <Route index element={page(<Home />)} />
        <Route path="chat/:id?" element={page(<Chat />)} />
        <Route path="kb" element={page(<Kb />)} />
        <Route path="kb/:id" element={page(<Product />)} />
        <Route path="brand" element={<Navigate to="/app/brand/strategy" replace />} />
        <Route path="brand/:section" element={page(<Brand />)} />
        <Route path="news" element={page(<News />)} />
        <Route path="review" element={page(<Review />)} />
        <Route path="files" element={page(<Files />)} />
        <Route path="integrations" element={page(<Integrations />)} />
        <Route path="team" element={page(<Team />)} />
        <Route path="gaps" element={page(<Gaps />)} />
        <Route path="settings" element={page(<Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
