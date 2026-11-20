import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ApartmentOutlined,
  BulbOutlined,
  DashboardOutlined,
  DownOutlined,
  LogoutOutlined,
  UserOutlined,
  LineChartOutlined,
  DollarCircleOutlined,
  MoonOutlined,
  SettingOutlined,
  ShareAltOutlined,
  CopyOutlined,
  RiseOutlined,
  RobotOutlined,
  SearchOutlined,
  SunOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Dropdown, Flex, Grid, Layout, Menu, Segmented, Spin, Tag, Typography, theme as antdTheme } from 'antd';
import type { MenuProps } from 'antd';
import Dashboard from './pages/Dashboard';
import AnalyticsPage from './pages/Analytics';
import AdminPage from './pages/Admin';
import SearchPage from './pages/Search';
import LookAlikePage from './pages/LookAlike';
import AssistantPage from './pages/Assistant';
import DuplicatesPage from './pages/Duplicates';
import LoginPage from './pages/Login';
import { useAuth } from './auth';
import Companies from './pages/Companies';
import Deals from './pages/Deals';
import DealCard from './pages/DealCard';
import Leads from './pages/Leads';
import LeadCard from './pages/LeadCard';
import Contacts from './pages/Contacts';
import CompanyCard from './pages/CompanyCard';
import ContactCard from './pages/ContactCard';
import Graph from './pages/Graph';
import { useThemeMode, type ThemeMode } from './theme';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useThemeMode();
  const { token } = antdTheme.useToken();
  const screens = Grid.useBreakpoint();
  const { user, ready, logout } = useAuth();

  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith('/analytics')) return '/analytics';
    if (location.pathname.startsWith('/contacts')) return '/contacts';
    if (location.pathname.startsWith('/deals')) return '/deals';
    if (location.pathname.startsWith('/leads')) return '/leads';
    if (location.pathname.startsWith('/graph')) return '/graph';
    if (location.pathname.startsWith('/search')) return '/search';
    if (location.pathname.startsWith('/lookalike')) return '/lookalike';
    if (location.pathname.startsWith('/assistant')) return '/assistant';
    if (location.pathname.startsWith('/duplicates')) return '/duplicates';
    if (location.pathname.startsWith('/admin')) return '/admin';
    if (location.pathname.startsWith('/companies')) return '/companies';
    return '/';
  }, [location.pathname]);

  // Группы меню: пункты-разделы раскрываются в выпадающие подменю.
  const items: MenuProps['items'] = [
    { key: '/', icon: <DashboardOutlined />, label: 'Дашборд' },
    {
      key: 'group-data',
      icon: <ApartmentOutlined />,
      label: (
        <span>
          Данные 
          <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
        </span>
      ),
      children: [
        { key: '/companies', icon: <ApartmentOutlined />, label: 'Компании' },
        { key: '/contacts', icon: <TeamOutlined />, label: 'Контакты' },
        { key: '/deals', icon: <DollarCircleOutlined />, label: 'Сделки' },
        { key: '/leads', icon: <BulbOutlined />, label: 'Лиды' },
      ],
    },
    {
      key: 'group-analytics',
      icon: <LineChartOutlined />,
      label: (
        <span>
          Аналитика 
          <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
        </span>
      ),
      children: [
        { key: '/analytics', icon: <LineChartOutlined />, label: 'Обзор' },
        { key: '/graph', icon: <ShareAltOutlined />, label: 'Граф связей' },
        { key: '/duplicates', icon: <CopyOutlined />, label: 'Дубли' },
      ],
    },
    {
      key: 'group-search',
      icon: <SearchOutlined />,
      label: (
        <span>
          Поиск 
          <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
        </span>
      ),
      children: [
        { key: '/search', icon: <SearchOutlined />, label: 'Поиск по смыслу' },
        { key: '/lookalike', icon: <RiseOutlined />, label: 'Потенциальные клиенты' },
      ],
    },
    { key: '/assistant', icon: <RobotOutlined />, label: 'Ассистент' },
    { key: '/admin', icon: <SettingOutlined />, label: 'Админка' },
  ];

  if (!ready) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!user) return <LoginPage />;

  const visibleItems = user.role === 'admin' ? items : items.filter((item) => item?.key !== '/admin');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          paddingInline: screens.md ? 24 : 12,
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={10} style={{ flexShrink: 0 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: token.colorPrimary,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            B
          </div>
          {screens.sm ? (
            <Text strong style={{ whiteSpace: 'nowrap' }}>
              CRM Analyzer
            </Text>
          ) : null}
        </Flex>

        <Menu
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={visibleItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
          overflowedIndicator={<Text type="secondary">…</Text>}
        />

        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'role', label: user.role === 'admin' ? 'Роль: администратор' : 'Роль: пользователь', disabled: true },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти' },
            ],
            onClick: ({ key }) => {
              if (key === 'logout') logout();
            },
          }}
        >
          <Flex
            align="center"
            gap={6}
            style={{ cursor: 'pointer', paddingInline: 8, whiteSpace: 'nowrap' }}
          >
            <UserOutlined />
            {screens.md ? <Text>{user.name || user.login}</Text> : null}
            <Tag color={user.role === 'admin' ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
              {user.role === 'admin' ? 'admin' : 'user'}
            </Tag>
          </Flex>
        </Dropdown>

        <Segmented
          size={screens.sm ? 'middle' : 'small'}
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { value: 'light', icon: <SunOutlined />, title: 'Светлая тема' },
            { value: 'dark', icon: <MoonOutlined />, title: 'Тёмная тема' },
          ]}
        />
      </Header>

      <Content
        style={{
          width: '100%',
          maxWidth: 1600,
          margin: '0 auto',
          padding: screens.md ? 24 : 12,
        }}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/companies/:id" element={<CompanyCard />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactCard />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/deals/:id" element={<DealCard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadCard />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/graph/:id" element={<Graph />} />
          <Route path="/admin" element={user.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/lookalike" element={<LookAlikePage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route
            path="*"
            element={<div style={{ padding: 24, textAlign: 'center' }}>Страница не найдена</div>}
          />
        </Routes>
      </Content>
    </Layout>
  );
}
