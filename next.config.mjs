/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/admin',
        destination: '/manage-attendance',
        permanent: true,
      },
      {
        source: '/admin/members',
        destination: '/manage-attendance/members',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
