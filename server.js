import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import dotenv from "dotenv";
import cors from "cors";
import specificProducts from "./specificProducts.js";
import { createClient } from "@supabase/supabase-js";
import itemRouter from "./Item.js";
import userProductsRouter from "./userProducts.js";

dotenv.config();

const app = express();
const saltRounds = 10;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const frontendOrigin = process.env.FRONTEND_URL.replace(/\/$/, "");

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (origin === frontendOrigin) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(passport.initialize());
app.use(passport.session());

passport.use(//tells passport: I am defining a new login method
    new Strategy(//this creates a local strategy=> login using username and password
      {usernameField: "username", passwordField: "password"}, //username comes from req.body.username and password comes from req.body.password
      async(username, password, cb)=>{
        try{
        const {data: users, error}=await supabase.from("users").select("*").eq("email",username);
        if(error)
          return cb(error)
        if(!users || users.length===0)
          return cb(null, false);
        const user=users[0];
        console.log("the user password is: "+user.password);
        bcrypt.compare(password, user.password, (err,valid)=>{
          if(err)
            return cb(err);
          return cb(null, valid? user : false);
        });
      }
      catch(err){
        return cb(err);
      }
      }
    )
);

passport.serializeUser((user, cb)=>cb(null, user));
passport.deserializeUser((user, cb)=>cb(null,user));

app.post("/login",(req,res,next)=>{
  passport.authenticate("local",(err, user)=>{
    if(err)
      return res.status(500).json({message: "Server Error"});
    if(!user)
      return res.status(401).json({message: "Invalid Credentials"});
    req.login(user, (err)=>{
        if(err)
          return res.status(500).json({message: "Login failed"});
        res.status(200).json({message: "Login successful", user});
    });
  })(req,res,next);
});
app.get("/logout",(req,res,next)=>{
    req.logout((err)=>{//calls the passport's logout function in order to remove the user from the session
      if(err)
        return next(err);
      res.clearCookie("connect.sid");
      res.status(200).json({message: "Logged out"});
      console.log("The user has been logged out");
    });
});

app.post("/signUp", async(req,res)=>{
    const {username: email, password, nameOfTheUser}=req.body;
    try{
        const {data: users}=await supabase.from("users").select("*").eq("email", email);
        if(users.length>=1)
          return res.status(400).json({message: "User already exists"});
        const hashedPassword= await bcrypt.hash(password, saltRounds);
        const {data: newUser, error}=await supabase.from("users").insert([{email, password: hashedPassword, nameoftheuser: nameOfTheUser},]).select().single();
        if(error)
          return res.status(500).json({message: "Error inserting the new user"});
        req.login(newUser, (err)=>{
          if(err)
            return res.status(500).json({message: "Error logging in"});
          res.status(200).json({message: "Login successful", user: newUser});
        });
    }
    catch(err){
      console.log("Error signing up: ",err);
    }
});

app.post("/addToCart", async(req,res)=>{
    const {email, productName, totalWeight, totalPrice}=req.query;
    console.log("The email is: "+email);
    try{
        const { data: existingEmail } = await supabase.from("userProducts").select("email").eq("email", email);
        if(existingEmail.length==0){
          const {error}=await supabase.from("userProducts").insert({email: email, product: productName, totalweight: totalWeight, totalprice: totalPrice});
          if(error)
            return res.status(400).json({success: false, message: "Error adding the user to the database"});
          res.status(200).json({success: true, message: "The data was added to the database successfully"});
        }
        else{
        const { data: existingProduct} = await supabase.from("userProducts").select("*").eq("email",email).eq("product",productName).maybeSingle();
        if(!existingProduct){
          const { error }= await supabase.from("userProducts").insert({email: email, product: productName, totalweight: totalWeight, totalprice: totalPrice});
          if(error)
            return res.status(400).json({success: false, message: "Error adding the products to the user's page"});
          res.status(200).json({success: true, message: "The product of the user was added to the database successfully"});
        }
        else{
          const {error}=await supabase.from("userProducts").update({totalweight: (existingProduct.totalweight)+parseFloat(totalWeight), totalprice: (existingProduct.totalprice)+parseFloat(totalPrice)}).eq("email",email).eq("product",productName);
          if(error)
            return res.status(400).json({success: false, message: "Error updating the products of the user"});
          res.status(200).json({success: true, message: "The data was updated successfully"});
        }
      }
    }
    catch(err){
        console.log("There is an error",err.message);
        return res.status(500).json({success: false, message: "Supabase error"});
    }
});

app.use("/api", specificProducts);
app.use("/api", itemRouter);
app.use("/api", userProductsRouter);

app.get("/debug", (req, res) => {
  res.json({
    status: "Server running",
    time: new Date().toISOString(),
    database: "Supabase",
    endpoints: [
      "/login",
      "/signUp",
      "/logout",
      "/api/products/:category",
      "/api/item/:category/:product",
      "/api/userProducts?email=...",
    ],
  });
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
