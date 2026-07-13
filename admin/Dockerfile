FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND_URL=http://localhost:4000
ARG VITE_CURRENCY=PKR
ARG VITE_PATIENT_URL=http://localhost:5173
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_CURRENCY=$VITE_CURRENCY
ENV VITE_PATIENT_URL=$VITE_PATIENT_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
