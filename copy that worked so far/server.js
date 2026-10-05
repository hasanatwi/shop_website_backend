import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
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

const upload = multer({ storage: multer.memoryStorage() });

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
app.post("/storeComponent",async(req,res)=>{
  const {specs, page_id}=req.body;//The specs are retrieved from the frontend successfully
  const {data: newComponent, error}=await supabase.from("component").insert([{specs:specs, page_id:page_id}]);
  if(error){
return res.status(500).json({message: "Error inserting the new component to the database"});
  }
res.status(200).json({message: "Inserting the new component to database was successful", component: newComponent});
});
app.post("/getComponents", async(req,res)=>{
  const {page_id}=req.body;
  const {data: components, error}=await supabase.from("component").select("*").eq("page_id",page_id);
  if(error)
    return res.status(500).json({message: "Error retrieving data from the database"});
  res.status(200).json({message: "Data was retrieved successfully from the database", components: components}); 
});
app.post("/addPage", async(req, res)=>{
const {newPageName}=req.body;
try{
const {data: newPage, error}=await supabase.from("page").insert([{name: newPageName}]);
      if(error){
        return res.status(500).json({message: "Error inserting the new page to the database"});
      }
      res.status(200).json({message: "The new page was inserted to the database successfully"});
    }
    catch(err){
}
});

app.post("/updateImageURL", upload.single("imageFile"), async(req,res)=>{
  try{
    if(!req.file){
      console.log("No image file was provided");
      return res.status(400).json({message: "No image file was provided"});
    }
    console.log("The image file was provided");
    const fileExt= req.file.originalname.split(".").pop();
    const fileName= `component-${Date.now()}.${fileExt}`;
    const {error: uploadError}= supabase.storage.from("backgrounds").upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });
    if(uploadError){
      return res.status(500).json({message: "Error uploading image to storage"});
    }
    const {data: publicUrlData }=supabase.storage.from("backgrounds").getPublicUrl(fileName);
    console.log("The online url is: ");
    console.log(publicUrlData);
    if(publicUrlData)
      res.status(200).json({imageUrl: publicUrlData, message: "The url was sent successfully"});
    }
  catch(err){
    console.log("There is an error, ",err);
  }
});

app.get("/getPages", async(req, res)=>{
  const {data: pages, error}=await supabase.from("page").select("*");
  if(error){
    return res.status(500).json({message: "Error retrieving the pages from the database"});
  }
  res.status(200).json({message: "The pages were retrieved from the database successfully", data: pages});
});
app.post("/updateComponent", async(req,res)=>{
  const {newSpecs, page_id, component_id}=req.body;
  console.log(`the page_id: ${page_id}`);
  console.log("The new specs are: ");
  console.log(newSpecs);
  const {error}=await supabase.from("component").update({specs: newSpecs}).eq("page_id", page_id).eq("component_id", component_id);
  if(error){
    return res.status(500).json({message: "An error has occured"});
  }
  else{
    res.status(200).json({message: "The data in the database was updated successfully"});
  }
});
app.get("/logout",(req,res,next)=>{
    req.logout((err)=>{//calls the passport's logout function in order to remove the user from the session
      if(err)
        return next(err);
      res.clearCookie("connect.sid");
      res.status(200).json({message: "Logged out"});
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
}
});

app.post("/updateBackground", async(req, res)=>{
  const {backgroundColor, backgroundImage, backgroundIsImage, page_id}=req.body;
  const {error}=await supabase.from("page").update({backgroundIsImage:backgroundIsImage,backgroundColor:backgroundColor,backgroundImage: backgroundImage}).eq("page_id",page_id);
  if(error){
    res.status(500).json({message: "Error updating the background in the database"});
  }
  res.status(200).json({message: "The background in the database was updated successfully"});
});
app.post("/updateBackgroundImage", upload.single("backgroundImage"), async (req, res) => {
  try {
const { page_id } = req.body;
    if (!req.file) {
return res.status(400).json({ message: "No image file was provided" });
    }

    // Upload the actual file bytes to Supabase Storage
    const fileExt = req.file.originalname.split(".").pop();
    const fileName = `page-${page_id}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("backgrounds")
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
return res.status(500).json({ message: "Error uploading image to storage" });
    }

    const { data: publicUrlData } = supabase.storage
      .from("backgrounds")
      .getPublicUrl(fileName);
const { error } = await supabase
      .from("page")
      .update({
        backgroundIsImage: true,
        backgroundImage: publicUrlData.publicUrl,//does this save in the supabase the same as the publicUrlData.publicUrl t t I printed before?
      })
      .eq("page_id", page_id);

    if (error) {
return res.status(500).json({ message: "Error updating the background in the database" });
    }

    res.status(200).json({ message: "The background in the database was updated successfully" });
  } catch (err) {
res.status(500).json({ message: "Server error" });
  }
});
app.get("/getBackground",async(req,res)=>{
const {page_id}=req.query;
    const {data: background, error}=await supabase.from("page").select("backgroundIsImage, backgroundColor, backgroundImage").eq("page_id", page_id);

    if(error)
      return res.status(500).json({message: "Error retrieving the background color from the database"});
    res.status(200).json({background, message: "The background was retrieved successfully"});
});

app.post("/addToCart", async(req,res)=>{
    const {email, productName, totalWeight, totalPrice}=req.query;
try{
        const { data: existingEmail } = await supabase.from("userProducts").select("email").eq("email", email);
        if(existingEmail.length===0){
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
