module.exports = {
  db_server: "mongodb://localhost:27017/",
  db_name: "alerter_db",
  pi_list_col_name: "pi_collection",
  http_req_col_name: "alert_collection",
  port: process.env.PORT || 6723,
  auth: { login: "coxems", password: "C0xMaddog15" }
};
